# html2lvgl editor

A visual editor for html2lvgl IR files. Work in progress: today it is a read-only viewer (milestone M1). The design, scope and milestone plan are in [../EDITOR.md](../EDITOR.md); how to run it is under [Running the editor](../EDITOR.md#running-the-editor).

```bash
html2lvgl --build-render && html2lvgl --preview-api   # terminal 1
cd editor && npm ci && npm run dev                    # terminal 2
```

This directory is not part of the published npm package.
