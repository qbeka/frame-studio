# Registering a component

Frame works only with what you declare. It does not read React internals, and it cannot import a component that has not been registered. Any website cannot be imported.

## What you supply

| You declare | Why Frame needs it |
|---|---|
| `id` and `version` | A project records what it was authored against, so a mismatched file is refused. |
| `states` | The semantic states, and which targets are in document flow in each one. |
| `targets` | Named parts Frame may move, how each draws its bounds, and whether it holds text. |
| `commands` | Named actions your component sends. Takes record these, never coordinates. |
| `transitions` | The allowed moves. Each one becomes editable. |
| `props` | Serializable inputs. Text you want to scrub through has to be a prop. |
| `reset` | Clears anything a remount would not, such as timers. |
| `render` | Draws the component with the context Frame passes. |

## Change your component

Your component takes one extra input, a frame handle. It uses it in three ways.

```tsx
export function Receipt({ frame, props, setProps }) {
  return (
    <article {...frame.root()}>
      <div {...frame.target('paper')} className="paper" aria-hidden="true" />
      <button {...frame.target('head')} onClick={() => frame.send('unfold')}>
        {props.vendor}
      </button>
      <ul {...frame.target('lines')}>...</ul>
    </article>
  );
}
```

`frame.target()` also sets `hidden` when the current state leaves that target out. Keep every state's markup mounted. That is what preserves typed text and focus through a transition.

## Register it

Create a file whose default export is a list. See [the receipt example](../examples/receipt-app/src/frame.registrations.tsx), which is 44 lines.

```bash
pnpm exec frame dev src/frame.registrations.tsx
```

## Run it in production

Nothing in your component changes. Production makes the same handle from the exported files.

```tsx
const frame = useFrame(motion);
const [props, setProps] = useState(initialProps);
return <Receipt frame={frame} props={props} setProps={(p) => setProps({ ...props, ...p })} />;
```

## Choosing a bounds mode

| Mode | Use it for | Rule |
|---|---|---|
| `translate` | Rows, labels, anything with text | Size snaps to the endpoint. |
| `surface` | A background layer | Must hold no text. It may keep a true border and radius at any size. |
| `clip` | The wrapper that reveals content | Its children stay still. Other targets may nest inside it. |
| `scale` | Icons and marks | Rejected when `text` is true. |

## Limits

- Targets may only nest inside a `clip` target. Anything else would move twice, and Frame warns.
- Elements outside the root are not animated. They take the endpoint layout on the first frame.
- A scaled ancestor is not corrected for, because it changes what a CSS pixel means.
- `display: inline` targets cannot be transformed.
