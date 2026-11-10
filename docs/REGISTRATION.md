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
| `exampleTake` | Optional. Named commands and their times. The studio opens on this take, so a first visit shows an interruption at once. |
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

## Let a hand drive it

A press is not the only way in. The handle has three more calls for a pointer that takes hold of a transition, moves it, and lets go.

```tsx
frame.grab('unfold', 0);   // take hold of the transition this command starts
frame.drag(0.4);           // 0 is the state being left, 1 the state being entered
frame.release();           // let go, and carry on into the state entered
frame.send('fold');        // or let go the other way, with the command that goes back
```

`grab` changes the state at once, as `send` does, and from then on every channel follows `drag` between the two measured layouts instead of following its curves. Progress may pass either end, so a pull can stretch. A hand outranks the interruption rules: it can take hold of a transition that is running, and the command it lets go with always leaves from where the hand was.

Letting go is an ordinary interruption. The spring starts from the hand's position, at the hand's speed, which is the slope of its last 80 ms of samples. A hand that has sent nothing for 50 ms has stopped, and lets go at rest. Under reduced motion the hand is still followed, and letting go lands at once.

You decide what a pointer means. The component, or the page around it, turns pixels into progress. The [project page](https://www.qendrimbeka.com/projects/frame/) does this for three components in [`site/src/hand.ts`](../site/src/hand.ts). A take records the hand as `grab`, `drag` and `release` events, so it replays like any other.

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
