<template>
  <!-- TODO: add a loader when data is not fully loaded or undefined -->
  <!-- TODO: add small loader with tooltips when stats can be expired -->
  <!-- TODO: display the NoDataError component in case of a data recovery error -->
  <LinearChart
    :data="data"
    :max-value="customMaxValue"
    :subtitle="$t('last-week')"
    :title="$t('pool-ram-usage')"
    :value-formatter="customValueFormatter"
  >
    <template #summary>
      <SizeStatsSummary :size="currentData.size" :usage="currentData.usage" />
    </template>
  </LinearChart>
</template>

<script lang="ts" setup>
import SizeStatsSummary from "@/components/ui/SizeStatsSummary.vue";
import { useHostCollection } from "@/stores/xen-api/host.store";
import { useHostMetricsCollection } from "@/stores/xen-api/host-metrics.store";
import { formatSize } from "@/libs/utils";
import { RRD_STEP_FROM_STRING } from "@/libs/xapi-stats";
import type { LinearChartData, ValueFormatter } from "@/types/chart";
import { IK_HOST_LAST_WEEK_STATS } from "@/types/injection-keys";
import { sumBy } from "lodash-es";
import { computed, defineAsyncComponent, inject } from "vue";
import { useI18n } from "vue-i18n";

const LinearChart = defineAsyncComponent(
  () => import("@/components/charts/LinearChart.vue")
);

const { runningHosts } = useHostCollection();
const { getHostMemory } = useHostMetricsCollection();

const { t } = useI18n();

const hostLastWeekStats = inject(IK_HOST_LAST_WEEK_STATS);

const customMaxValue = computed(() =>
  sumBy(runningHosts.value, (host) => getHostMemory(host)?.size ?? 0)
);

const currentData = computed(() => {
  let size = 0,
    usage = 0;
  runningHosts.value.forEach((host) => {
    const hostMemory = getHostMemory(host);
    size += hostMemory?.size ?? 0;
    usage += hostMemory?.usage ?? 0;
  });
  return { size, usage };
});

const data = computed<LinearChartData>(() => {
  const timestampStart = hostLastWeekStats?.timestampStart?.value;
  const stats = hostLastWeekStats?.stats?.value;

  if (timestampStart === undefined || stats == null) {
    return [];
  }

  const result = new Map<number, { timestamp: number; value: number }>();

  stats.forEach(({ stats }) => {
    if (stats?.memory === undefined) {
      return;
    }

    const memoryFree = stats.memoryFree;
    const memoryUsage = stats.memory.map(
      (memory, index) => memory - memoryFree[index]
    );

    memoryUsage.forEach((value, hourIndex) => {
      const timestamp =
        (timestampStart + hourIndex * RRD_STEP_FROM_STRING.hours) * 1000;

      result.set(timestamp, {
        timestamp,
        value: (result.get(timestamp)?.value ?? 0) + memoryUsage[hourIndex],
      });
    });
  });

  return [
    {
      label: t("stacked-ram-usage"),
      data: Array.from(result.values()),
    },
  ];
});

const customValueFormatter: ValueFormatter = (value) =>
  String(formatSize(value));
</script>
