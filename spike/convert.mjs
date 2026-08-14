#!/usr/bin/env node
/**
 * Phase 0 spike — step 2: conversion.
 *
 * Turns the extracted UI-tree JSON into an LVGL XML component (v9.4 lv_xml
 * runtime syntax). Spike scope: absolute positioning from Chromium's layout
 * (the html-to-figma baseline approach); flex/grid mapping is Phase 1 work.
 *
 * Usage: node convert.mjs out/login.json out/login.xml
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , jsonIn, xmlOut] = process.argv;
if (!jsonIn || !xmlOut) {
  console.error('usage: node convert.mjs <in.json> <out.xml>');
  process.exit(1);
}

const tree = JSON.parse(readFileSync(jsonIn, 'utf8'));

// Montserrat sizes enabled in the render harness's lv_conf.h and registered
// in main.c as fonts named "montserrat_<size>".
const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];

// Montserrat runs wider than default browser sans-serif fonts, so pick the
// largest enabled size that does NOT exceed the CSS px size — undersizing
// beats clipped text.
const nearestFont = (px) =>
  'montserrat_' + (FONT_SIZES.filter((s) => s <= px).pop() ?? FONT_SIZES[0]);

const hex = ([r, g, b]) =>
  '0x' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a', 'div']);

let idCounter = 0;
const uid = (prefix) => `${prefix}_${++idCounter}`;

/** Common geometry attributes, relative to the parent's content origin. */
function geom(node, parent) {
  const x = node.x - parent.x - parent.styles.borderWidth;
  const y = node.y - parent.y - parent.styles.borderWidth;
  return `x="${x}" y="${y}" width="${node.w}" height="${node.h}"`;
}

/** Visual style attributes shared by containers and buttons. */
function boxStyles(node, { transparentDefault = true, pad = 0 } = {}) {
  const s = node.styles;
  const parts = [];
  if (s.bgColor) {
    parts.push(`style_bg_color="${hex(s.bgColor)}"`);
    if (s.bgColor[3] < 255) parts.push(`style_bg_opa="${s.bgColor[3]}"`);
  } else if (transparentDefault) {
    parts.push(`style_bg_opa="0"`);
  }
  if (s.borderWidth > 0 && s.borderColor) {
    parts.push(`style_border_width="${s.borderWidth}"`, `style_border_color="${hex(s.borderColor)}"`);
  } else {
    parts.push(`style_border_width="0"`);
  }
  parts.push(`style_radius="${s.radius}"`);
  parts.push(`style_pad_all="${pad}"`, `style_shadow_width="0"`);
  return parts.join(' ');
}

function textStyles(node) {
  const s = node.styles;
  const parts = [`style_text_font="${nearestFont(s.fontSize)}"`];
  if (s.color) parts.push(`style_text_color="${hex(s.color)}"`);
  if (s.textAlign === 'center') parts.push(`style_text_align="center"`);
  else if (s.textAlign === 'right') parts.push(`style_text_align="right"`);
  return parts.join(' ');
}

function emit(node, parent, indent) {
  const pad = '  '.repeat(indent);
  const g = geom(node, parent);

  // <button> -> lv_button with a centered label
  if (node.tag === 'button') {
    const label = node.text
      ? `\n${pad}  <lv_label name="${uid('label')}" align="center" text="${esc(node.text)}" ${textStyles(node)} />`
      : '';
    return `${pad}<lv_button name="${uid('button')}" ${g} ${boxStyles(node, { transparentDefault: false })}>${label}\n${pad}</lv_button>`;
  }

  if (node.tag === 'input') {
    const t = node.attrs.type;
    if (t === 'range') {
      // Browsers draw a thin track inside the input's box; approximate with a
      // slim slider vertically centered in the original rect.
      const trackH = 8;
      const x = node.x - parent.x;
      const y = node.y - parent.y + Math.round((node.h - trackH) / 2);
      return `${pad}<lv_slider name="${uid('slider')}" x="${x}" y="${y}" width="${node.w}" height="${trackH}" min_value="${node.attrs.min ?? 0}" max_value="${node.attrs.max ?? 100}" value="${node.attrs.value ?? 0}" />`;
    }
    if (t === 'checkbox') {
      return `${pad}<lv_switch name="${uid('switch')}" ${g}${node.attrs.checked ? ' checked="true"' : ''} />`;
    }
    // text / password / etc.
    const placeholder = node.attrs.placeholder ? ` placeholder_text="${esc(node.attrs.placeholder)}"` : '';
    const value = node.attrs.value ? ` text="${esc(node.attrs.value)}"` : '';
    const pw = t === 'password' ? ' password_mode="true"' : '';
    return `${pad}<lv_textarea name="${uid('textarea')}" ${g} one_line="true"${placeholder}${value}${pw} ${boxStyles(node, { transparentDefault: false, pad: 8 })} ${textStyles(node)} />`;
  }

  // Leaf element with text and no children
  if (node.text && node.children.length === 0 && TEXT_TAGS.has(node.tag)) {
    const s = node.styles;
    if (s.bgColor || (s.borderWidth > 0 && s.borderColor)) {
      // Decorated text block (e.g. a title bar): a styled box with the text
      // vertically centered inside, the way browsers center line boxes.
      const align = s.textAlign === 'center' ? 'center' : 'left_mid';
      const off = align === 'left_mid' && s.padLeft ? ` x="${s.padLeft}"` : '';
      return (
        `${pad}<lv_obj name="${uid('box')}" ${g} ${boxStyles(node)} scrollable="false">\n` +
        `${pad}  <lv_label name="${uid('label')}" align="${align}"${off} text="${esc(node.text)}" ${textStyles(node)} />\n` +
        `${pad}</lv_obj>`
      );
    }
    // Plain text: let the label auto-size so wider LVGL fonts don't clip.
    // Keep the width when the browser centered/right-aligned text inside it.
    const x = node.x - parent.x - parent.styles.borderWidth;
    const y = node.y - parent.y - parent.styles.borderWidth;
    const keepWidth = s.textAlign === 'center' || s.textAlign === 'right';
    const size = keepWidth ? ` width="${node.w}"` : '';
    return `${pad}<lv_label name="${uid('label')}" x="${x}" y="${y}"${size} text="${esc(node.text)}" ${textStyles(node)} />`;
  }

  // Generic container
  const children = node.children.map((c) => emit(c, node, indent + 1));
  const openTag = `${pad}<lv_obj name="${uid('box')}" ${g} ${boxStyles(node)} scrollable="false">`;
  if (node.text) {
    children.unshift(
      `${pad}  <lv_label name="${uid('label')}" text="${esc(node.text)}" ${textStyles(node)} />`
    );
  }
  return children.length ? `${openTag}\n${children.join('\n')}\n${pad}</lv_obj>` : `${openTag}</lv_obj>`;
}

// The <body> becomes the component's root view.
const rootStyles = boxStyles(tree);
const children = tree.children.map((c) => emit(c, tree, 2)).join('\n');
const xml = `<component>
  <view width="${tree.w}" height="${tree.h}" ${rootStyles} scrollable="false" ${textStyles(tree)}>
${children}
  </view>
</component>
`;

writeFileSync(xmlOut, xml);
console.log(`converted ${jsonIn} -> ${xmlOut}`);
