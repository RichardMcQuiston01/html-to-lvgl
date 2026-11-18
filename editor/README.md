# html2lvgl editor

A visual editor for html2lvgl IR files. Work in progress: today it views a page, edits widget attributes, drags and resizes widgets on the picture, adds, reorders and removes widgets, and saves the edits as the page's sidecar (milestones M1 to M4). The design, scope and milestone plan are in [../EDITOR.md](../EDITOR.md); how to run it is under [Running the editor](../EDITOR.md#running-the-editor).

```bash
html2lvgl --build-render && html2lvgl --preview-api --workspace .   # terminal 1 (--workspace: where sidecars are saved)
cd editor && npm ci && npm run dev                    # terminal 2
```

This directory is not part of the published npm package.
