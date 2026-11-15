/** The left panel before creating: every choice, the Create button and the equivalent terminal command. */
import { Fragment, useEffect, useRef } from 'react'
import type { AddOn, AddOnId, ProjectOptions } from '../../options.ts'
import type { BuilderInfo, FieldErrors } from '../../ui-server.ts'
import { cliCommand, joinPath } from '../lib/command.ts'
import { copyText } from '../lib/toast.ts'
import { ChoiceCard, Section, Switch, TextField } from './fields.tsx'
import { CopyIcon } from './icons.tsx'

interface Props {
  info: BuilderInfo
  options: ProjectOptions
  onChange: (patch: Partial<ProjectOptions>) => void
  errors: FieldErrors
  /** The resolved project folder from the last preview. */
  target: string
  formError: string | null
  submitting: boolean
  onSubmit: () => void
}

export function BuilderForm({ info, options, onChange, errors, target, formError, submitting, onSubmit }: Props) {
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const blocked = submitting || Object.keys(errors).length > 0
  const command = cliCommand(info, options)

  const toggleAddOn = (id: AddOnId, on: boolean) => {
    // Keep the catalog's order, so the command and the server see a stable list.
    const addOns = info.addOns.filter((a) => (a.id === id ? on : options.addOns.includes(a.id))).map((a) => a.id)
    onChange({ addOns })
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) onSubmit()
      }}
    >
      <Section number={1} title="Project">
        <TextField id="name" label="Name" value={options.name} error={errors.name} inputRef={nameRef} onChange={(name) => onChange({ name })} />
        <TextField
          id="parentDir"
          label="Location"
          value={options.parentDir}
          error={errors.parentDir}
          onChange={(parentDir) => onChange({ parentDir })}
        />
        <div className="target">
          <span>Creates</span>
          <code>{target || joinPath(options.parentDir, options.name)}</code>
        </div>
      </Section>

      <Section number={2} title="Framework">
        <div className="addons" role="radiogroup" aria-label="Framework">
          {info.frameworks.map((framework) => (
            <ChoiceCard
              key={framework.id}
              type="radio"
              name="framework"
              checked={options.framework === framework.id}
              onChange={() => onChange({ framework: framework.id })}
              title={framework.name}
              description={framework.description}
            />
          ))}
        </div>
      </Section>

      <Section number={3} title="Design pattern">
        <div className="addons one-column" role="radiogroup" aria-label="Design pattern">
          {info.patterns.map((pattern) => (
            <ChoiceCard
              key={pattern.id}
              type="radio"
              name="pattern"
              checked={options.pattern === pattern.id}
              onChange={() => onChange({ pattern: pattern.id })}
              title={pattern.name}
              description={pattern.description}
              meta={`Best for: ${pattern.bestFor} · Learning curve: ${pattern.learningCurve}`}
            />
          ))}
        </div>
      </Section>

      <Section number={4} title="Add-ons">
        <div className="addons">
          {groupAddOns(info.addOns).map(([group, addOns]) => (
            <Fragment key={group}>
              <div className="addon-group">{group}</div>
              {addOns.map((addOn) => (
                <ChoiceCard
                  key={addOn.id}
                  type="checkbox"
                  checked={options.addOns.includes(addOn.id)}
                  onChange={(on) => toggleAddOn(addOn.id, on)}
                  title={addOn.name}
                  description={addOn.description}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </Section>

      <Section number={5} title="Package manager">
        <div className="segmented" role="radiogroup" aria-label="Package manager">
          {info.packageManagers.map(({ id, version }) => (
            <label key={id} className="seg" title={version ? `${id} ${version}` : `${id} is not installed`}>
              <input
                type="radio"
                name="pm"
                value={id}
                checked={options.packageManager === id}
                disabled={!version}
                onChange={() => onChange({ packageManager: id })}
              />
              <span className="seg-name">{id}</span>
              <span className="seg-version">{version ?? 'not installed'}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section number={6} title="Setup">
        <div className="toggles">
          <Switch
            checked={options.install}
            onChange={(install) => onChange({ install })}
            title="Install dependencies"
            description={
              <>
                Runs <code>{options.packageManager} install</code> in the new folder.
              </>
            }
          />
          <Switch
            checked={options.git}
            disabled={!info.git}
            onChange={(git) => onChange({ git })}
            title="Initialize a git repository"
            description={
              info.git ? (
                <>
                  Runs <code>git init</code> and makes a first commit.
                </>
              ) : (
                'git is not installed.'
              )
            }
          />
        </div>
      </Section>

      <Section>
        {formError && <div className="form-error">{formError}</div>}
        <button className="btn btn-primary" type="submit" disabled={blocked}>
          Create project
        </button>
        <div className="cli">
          <span className="cli-label">Terminal</span>
          <code>{command}</code>
          <button className="icon-btn" type="button" title="Copy command" aria-label="Copy command" onClick={() => copyText(command, 'Command copied')}>
            <CopyIcon />
          </button>
        </div>
      </Section>
    </form>
  )
}

/** Consecutive add-ons with the same group, in catalog order. */
function groupAddOns(addOns: AddOn[]): [string, AddOn[]][] {
  const groups: [string, AddOn[]][] = []
  for (const addOn of addOns) {
    const last = groups[groups.length - 1]
    if (last && last[0] === addOn.group) last[1].push(addOn)
    else groups.push([addOn.group, [addOn]])
  }
  return groups
}
