<template>
  <MenuItem :icon="faFileExport">
    {{ $t("export") }}
    <template #submenu>
      <MenuItem
        v-tooltip="{ content: $t('coming-soon'), placement: 'left' }"
        :icon="faDisplay"
      >
        {{ $t("export-vms") }}
      </MenuItem>
      <MenuItem
        :icon="faCode"
        @click="
          exportVmsAsJsonFile(vms, `vms_${new Date().toISOString()}.json`)
        "
      >
        {{ $t("export-table-to", { type: ".json" }) }}
      </MenuItem>
      <MenuItem
        :icon="faFileCsv"
        @click="exportVmsAsCsvFile(vms, `vms_${new Date().toISOString()}.csv`)"
      >
        {{ $t("export-table-to", { type: ".csv" }) }}
      </MenuItem>
    </template>
  </MenuItem>
</template>

<script lang="ts" setup>
import { useVmCollection } from "@/stores/xen-api/vm.store";
import { computed } from "vue";
import { exportVmsAsCsvFile, exportVmsAsJsonFile } from "@/libs/vm";
import MenuItem from "@/components/menu/MenuItem.vue";
import {
  faCode,
  faDisplay,
  faFileCsv,
  faFileExport,
} from "@fortawesome/free-solid-svg-icons";
import { vTooltip } from "@/directives/tooltip.directive";
import type { XenApiVm } from "@/libs/xen-api/xen-api.types";

const props = defineProps<{
  vmRefs: XenApiVm["$ref"][];
}>();

const { getByOpaqueRef: getVm } = useVmCollection();
const vms = computed(() =>
  props.vmRefs.map(getVm).filter((vm): vm is XenApiVm => vm !== undefined)
);
</script>
