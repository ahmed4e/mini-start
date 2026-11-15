import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, toScriptSafeJson } from "../framework/src/ssr/serializer.ts";
import { createHtmlInjector, SsrStream } from "../framework/src/ssr/stream.ts";

const roundTrip = (value: unknown) =>
  decode(JSON.parse(JSON.stringify(encode(value))));

describe("serializer", () => {
  it("round-trips values JSON cannot represent", () => {
    const value = {
      date: new Date("2026-01-01T00:00:00Z"),
      map: new Map<unknown, unknown>([
        ["a", 1],
        [2, new Set(["x"])],
      ]),
      big: 10n ** 20n,
      nothing: undefined,
      nan: Number.NaN,
      negZero: -0,
      inf: Number.NEGATIVE_INFINITY,
      re: /a+b/gi,
      url: new URL("https://example.com/x?y=1"),
      list: [1, undefined, "three"],
      tagLookalike: { $m: "date", v: "not really" },
    };
    const back = roundTrip(value) as typeof value;
    assert.deepEqual(back, value);
    assert.ok(Object.is(back.negZero, -0));
  });

  it("serializes errors, with stacks only when asked", () => {
    const err = new TypeError("bad");
    const plain = decode(encode(err)) as Error;
    assert.equal(plain.name, "TypeError");
    assert.equal(plain.message, "bad");
    const withStack = encode(err, { includeStack: true }) as {
      v: { stack?: string };
    };
    assert.ok(withStack.v.stack?.includes("TypeError"));
  });

  it("cannot be used to pollute prototypes", () => {
    const decoded = decode(
      JSON.parse('{"__proto__": {"polluted": true}}'),
    ) as Record<string, unknown>;
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  });

  it("rejects circular structures and unexpected promises", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    assert.throws(() => encode(a), /circular/);
    assert.throws(() => encode({ p: Promise.resolve(1) }), /Promise/);
    // A repeated (non-circular) reference is fine.
    const shared = { x: 1 };
    assert.deepEqual(roundTrip([shared, shared]), [{ x: 1 }, { x: 1 }]);
  });

  it("escapes script-breaking characters", () => {
    const out = toScriptSafeJson({
      html: "</script><script>alert(1)</script>",
      ls: "line separator paragraph",
    });
    assert.ok(!out.includes("</script>"));
    assert.ok(!out.includes(" "));
    assert.ok(!out.includes(" "));
    assert.deepEqual(JSON.parse(out), {
      html: "</script><script>alert(1)</script>",
      ls: "line separator paragraph",
    });
  });
});

async function readAll(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let out = "";
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>)
    out += decoder.decode(chunk, { stream: true });
  return out;
}

describe("streaming injector", () => {
  it("embeds promise references and streams their values after a </script>", async () => {
    let resolveSlow!: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    const ssr = new SsrStream({ fast: 1, slow });
    assert.match(ssr.bootstrapScript, /"slow":\{"\$m":"promise","v":0\}/);

    const encoder = new TextEncoder();
    const chunks = [
      "<html><body><div>shell</div><script>boot()</script>",
      '<div hidden id="S:0">done</div><script>$RC("B:0","S:0")</script>',
      "</body></html>",
    ];
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(chunks[0]));
        resolveSlow({ when: new Date(0) });
        await new Promise((r) => setTimeout(r, 5));
        controller.enqueue(encoder.encode(chunks[1]));
        controller.enqueue(encoder.encode(chunks[2]));
        controller.close();
      },
    });
    const html = await readAll(source.pipeThrough(createHtmlInjector(ssr)));
    const injected = html.indexOf("<script>(function(m,i,o,v)");
    assert.ok(injected > 0, "value script injected");
    assert.equal(
      html.slice(injected - "</script>".length, injected),
      "</script>",
      "only at a safe point",
    );
    assert.ok(
      injected > html.indexOf("boot()</script>"),
      "after the bootstrap",
    );
    assert.ok(html.endsWith("</body></html>"), "document end kept last");
    assert.equal(
      html.split("<script>(function(m,i,o,v)").length - 1,
      1,
      "each value is sent once",
    );
    assert.ok(
      html.includes('"$m":"date"'),
      "value encoded with the serializer",
    );
  });

  it("flushes values for promises that never reached the UI before closing", async () => {
    const ssr = new SsrStream({
      unused: new Promise((r) => setTimeout(() => r("late"), 10)),
    });
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("<html><body>x</body></html>"),
        );
        controller.close();
      },
    });
    const html = await readAll(source.pipeThrough(createHtmlInjector(ssr)));
    assert.match(
      html,
      /"late"\);document\.currentScript\.remove\(\)<\/script><\/body><\/html>$/,
    );
  });
});
