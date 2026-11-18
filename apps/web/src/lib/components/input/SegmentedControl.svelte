<script lang="ts" generics="Value extends string | boolean">
  let {
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: readonly { value: Value; label: string }[];
    value: Value;
    onChange: (value: Value) => void;
  } = $props();

  const name = $props.id();
</script>

<div class="segments" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <label>
      <input
        type="radio"
        {name}
        value={String(option.value)}
        checked={value === option.value}
        onchange={() => onChange(option.value)}
      />
      <span>{option.label}</span>
    </label>
  {/each}
</div>

<style>
  .segments {
    display: flex;
    background: var(--card-2, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    overflow: hidden;
  }
  label {
    position: relative;
    display: flex;
    flex: 1;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  span {
    flex: 1;
    text-align: center;
    padding: 0.4rem 0.55rem;
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg));
  }
  input:checked + span {
    background: var(
      --accent-soft,
      color-mix(in oklch, var(--accent, var(--color-accent)) 18%, transparent)
    );
    color: var(--ink, var(--color-fg));
    font-weight: 600;
  }
  @media (hover: hover) {
    input:hover:not(:disabled) + span {
      background: color-mix(in oklch, var(--accent, var(--color-accent)) 12%, var(--card, var(--color-bg)));
    }
    input:checked:hover:not(:disabled) + span {
      background: color-mix(in oklch, var(--accent, var(--color-accent)) 25%, var(--card, var(--color-bg)));
    }
  }
  input:focus-visible + span {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: -2px;
  }
  input:disabled {
    cursor: default;
  }
</style>
