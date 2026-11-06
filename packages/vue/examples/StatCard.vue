<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
});
</script>

<template>
  <div class="card">
    <span class="label">{{ label }}</span>
    <span class="value">{{ value }}</span>
  </div>
</template>

<style scoped>
.card { display: flex; flex-direction: row; justify-content: space-between; align-items: center; background: #1c2a38; border-radius: 8px; padding: 8px 12px; }
.label { font-size: 14px; color: #9fb3c8; }
.value { font-size: 16px; font-weight: 700; color: #ffffff; }
</style>
