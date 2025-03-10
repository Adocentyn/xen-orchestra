<template>
  <span :class="wrapperClass" class="container" v-bind="wrapperAttrs">
    <template v-if="inputType === 'select'">
      <select
        :id="id"
        ref="inputElement"
        v-model="value"
        :class="inputClass"
        :disabled="isDisabled"
        :required="required"
        class="select"
        v-bind="$attrs"
      >
        <slot />
      </select>
      <span class="caret">
        <UiIcon :fixed-width="false" :icon="faAngleDown" />
      </span>
    </template>
    <textarea
      v-else-if="inputType === 'textarea'"
      :id="id"
      ref="textarea"
      v-model="value"
      :class="inputClass"
      :disabled="isDisabled"
      :required="required"
      class="textarea"
      v-bind="$attrs"
    />
    <input
      v-else
      :id="id"
      ref="inputElement"
      v-model="value"
      :class="inputClass"
      :disabled="isDisabled"
      :required="required"
      class="input"
      v-bind="$attrs"
    />
    <span v-if="before !== undefined" class="before">
      <template v-if="typeof before === 'string'">{{ before }}</template>
      <UiIcon v-else :icon="before" class="before" />
    </span>
    <span v-if="after !== undefined" class="after">
      <template v-if="typeof after === 'string'">{{ after }}</template>
      <UiIcon v-else :icon="after" class="after" />
    </span>
  </span>
</template>

<script lang="ts" setup>
import UiIcon from "@/components/ui/icon/UiIcon.vue";
import { useContext } from "@/composables/context.composable";
import { ColorContext, DisabledContext } from "@/context";
import type { Color } from "@/types";
import { IK_INPUT_ID, IK_INPUT_TYPE } from "@/types/injection-keys";
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import { faAngleDown } from "@fortawesome/free-solid-svg-icons";
import { useTextareaAutosize, useVModel } from "@vueuse/core";
import {
  computed,
  type HTMLAttributes,
  inject,
  nextTick,
  ref,
  watch,
} from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    id?: string;
    modelValue?: any;
    color?: Color;
    before?: IconDefinition | string;
    after?: IconDefinition | string;
    beforeWidth?: string;
    afterWidth?: string;
    disabled?: boolean;
    required?: boolean;
    right?: boolean;
    wrapperAttrs?: HTMLAttributes;
  }>(),
  { disabled: undefined }
);

const { name: contextColor } = useContext(ColorContext, () => props.color);

const inputElement = ref();

const emit = defineEmits<{
  (event: "update:modelValue", value: any): void;
}>();

const value = useVModel(props, "modelValue", emit);
const isEmpty = computed(
  () => props.modelValue == null || String(props.modelValue).trim() === ""
);
const inputType = inject(IK_INPUT_TYPE, "input");

const isDisabled = useContext(DisabledContext, () => props.disabled);

const wrapperClass = computed(() => [
  `form-${inputType}`,
  {
    disabled: isDisabled.value,
    empty: isEmpty.value,
  },
]);

const inputClass = computed(() => [
  contextColor.value,
  {
    right: props.right,
    "has-before": props.before !== undefined,
    "has-after": props.after !== undefined,
  },
]);

const parentId = inject(IK_INPUT_ID, undefined);

const id = computed(() => props.id ?? parentId?.value);

const { textarea, triggerResize } = useTextareaAutosize();

watch(value, () => nextTick(() => triggerResize()), {
  immediate: true,
});

const focus = () => inputElement.value.focus();

defineExpose({
  focus,
});
</script>

<style lang="postcss" scoped>
.container {
  font-size: 2rem;
}

.form-input,
.form-select,
.form-textarea {
  display: grid;
  align-items: stretch;
  max-width: 30em;

  --before-width: v-bind('beforeWidth || "1.75em"');
  --after-width: v-bind('afterWidth || "1.625em"');
  --caret-width: 1.5em;

  --text-color: var(--color-blue-scale-100);

  &.empty {
    --text-color: var(--color-blue-scale-300);
  }

  &.disabled {
    --text-color: var(--color-blue-scale-400);
  }
}

.form-input,
.form-textarea {
  grid-template-columns: var(--before-width) auto var(--after-width);
}

.form-select {
  grid-template-columns:
    var(--before-width)
    auto
    var(--after-width)
    var(--caret-width);
}

.input,
.textarea,
.select {
  font-size: 1em;
  width: 100%;
  height: 3em;
  margin: 0;
  color: var(--text-color);
  border: 0.05em solid var(--border-color);
  border-radius: 0.4em;
  outline: none;
  background-color: var(--background-color);
  box-shadow: var(--shadow-100);
  grid-row: 1 / 2;
  grid-column: 1 / 4;

  &.right {
    text-align: right;
  }

  --background-color: var(--background-color-primary);
  --border-color: var(--color-blue-scale-400);

  &:disabled {
    cursor: not-allowed;
    --background-color: var(--background-color-secondary);
  }

  &:not(:disabled) {
    &.info {
      &:hover {
        --border-color: var(--color-extra-blue-l60);
      }

      &:active {
        --border-color: var(--color-extra-blue-l40);
      }

      &:focus {
        --border-color: var(--color-extra-blue-base);
      }
    }

    &.success {
      --border-color: var(--color-green-infra-base);

      &:hover {
        --border-color: var(--color-green-infra-l60);
      }

      &:active {
        --border-color: var(--color-green-infra-l40);
      }

      &:focus {
        --border-color: var(--color-green-infra-base);
      }
    }

    &.warning {
      --border-color: var(--color-orange-world-base);

      &:hover {
        --border-color: var(--color-orange-world-l60);
      }

      &:active {
        --border-color: var(--color-orange-world-l40);
      }

      &:focus {
        --border-color: var(--color-orange-world-base);
      }
    }

    &.error {
      --border-color: var(--color-red-vates-base);

      &:hover {
        --border-color: var(--color-red-vates-l60);
      }

      &:active {
        --border-color: var(--color-red-vates-l40);
      }

      &:focus-within {
        --border-color: var(--color-red-vates-base);
      }
    }
  }
}

.textarea {
  height: auto;
  min-height: 2em;
}

.input {
  padding: 0;
}

.input,
.textarea {
  padding-right: 0.625em;
  padding-left: 0.625em;

  &.has-before {
    padding-left: calc(var(--before-width) + 0.25em);
  }

  &.has-after {
    padding-right: calc(var(--after-width) + 0.25em);
  }
}

.select {
  min-width: fit-content;
  padding: 0 calc(var(--caret-width) + 0.25em) 0 0.625em;
  grid-column: 1 / 5;
  appearance: none;

  &.has-before {
    padding-left: calc(var(--before-width) + 0.25em);
  }

  &.has-after {
    padding-right: calc(var(--after-width) + 0.25em + var(--caret-width));
  }
}

.before,
.after,
.caret {
  display: inline-flex;
  align-items: center;
  pointer-events: none;
  color: var(--text-color);
  grid-row: 1 / 2;
}

.before {
  justify-self: end;
  grid-column: 1 / 2;
}

.after {
  justify-self: start;
  grid-column: 3 / 4;
}

.caret {
  justify-self: start;
  grid-column: 4 / 5;
}
</style>
