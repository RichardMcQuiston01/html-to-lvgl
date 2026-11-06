<script setup lang="ts">
import { ref } from 'vue';
import StatCard from './StatCard.vue';

interface Stat { id: number; label: string; value: string }

const title = ref('Dashboard');
const online = ref(true);
const stats: Stat[] = [
  { id: 1, label: 'Temp', value: '21 C' },
  { id: 2, label: 'Humidity', value: '48 %' },
  { id: 3, label: 'Pressure', value: '1013' },
];
</script>

<template>
  <main class="page">
    <header class="bar">
      <h1>{{ title }}</h1>
      <span v-if="online" class="badge">Online</span>
      <span v-else class="badge off">Offline</span>
    </header>
    <section class="stats">
      <StatCard v-for="s in stats" :key="s.id" :label="s.label" :value="s.value" />
    </section>
  </main>
</template>

<style scoped>
.page { display: flex; flex-direction: column; width: 320px; height: 240px; background: #101820; color: #ffffff; font-family: sans-serif; padding: 8px; box-sizing: border-box; gap: 8px; }
.bar { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
h1 { font-size: 20px; margin: 0; }
.badge { background: #2e7d32; color: #ffffff; border-radius: 10px; padding: 2px 8px; font-size: 12px; }
.off { background: #b71c1c; }
.stats { display: flex; flex-direction: column; gap: 6px; }
</style>
