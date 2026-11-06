<script>
export default {
  name: 'PlainList',
  data: () => ({ items: ['a', 'b'], show: false }),
};
</script>

<template>
  <ul class="list" style="margin:0;padding:10px;width:200px;background:#eee">
    <li v-for="i in items" :key="i">{{ i }}</li>
    <li v-if="show">hidden</li>
  </ul>
</template>
