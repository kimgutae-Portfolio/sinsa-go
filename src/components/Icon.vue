<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  sound: "M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  muted: "M11 5 6 9H3v6h3l5 4V5Zm5 4 6 6m-6 0 6-6",
  lantern:
    "M9 3h6m-3-2v2M8 5h8m-8 14h8M9 21h6M12 21v2M8 5c-5 3-5 11 0 14m8-14c5 3 5 11 0 14M12 5v14M5 9h14M5 15h14",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  link: "M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  shrine: "M3 5Q12 8 21 5M4 10h16M7 7v14M17 7v14M11 8v2M5 21h4m6 0h4",
  leaf: "M20 4C8 2 3 9 6 15c3 6 14 4 14-11ZM5 21 16 9M10 15h5",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12M6 18 18 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
  help: "M9.1 8a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  compass: "m16 8-3 5-5 3 3-5 5-3ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  check: "m5 12 4 4L19 6",
  fortune: "M7 3h10v18l-5-3-5 3V3Zm3 5h4m-4 4h4",
  ema: "m4 8 8-5 8 5v12H4V8Zm8-5v6m-5 4h10m-8 3h6",
  water:
    "M3 9h11a3 3 0 0 0 3-3V4m0 0h4M17 4v2M5 9c0 3 2 5 6 5s6-2 6-5M8 18c0 1.7 1.3 3 3 3s3-1.3 3-3c0-2-3-5-3-5s-3 3-3 5Z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  keyboard:
    "M3 6h18v12H3V6Zm3 3h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01M8 15h8",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
};
</script>
<template>
  <svg
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.leaf" />
  </svg>
</template>
