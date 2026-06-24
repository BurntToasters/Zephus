# Zephus
A WYSIWYG Local GUI web editor; edit your git-hosted sites!

> [!IMPORTANT]
> Zephus is a project of mine that for the foreseeable future should not be treated as a stable, production-ready product. If you use this app to create or edit websites, please do be aware of the risks that are inherent with using this unstable app.
>
> Zephus also uses electron which im not the proudest about, but seeing as its a web editor, I figured out of a lot of the options it was the easiest to work with for this project.
>
> Zephus can ONLY edit/work with sites that have been created by Zephus in the app! It is not compatible with general astro-created sites unfortunately as I have a whole schema developed for the engine. If you try to force it to work with a non-zephus-made app, your site will break.

## Documentation
To understand more how Zephus works and how to use it, please read the current documentation **[HERE](./docs/README.md)**.

## License

Zephus is free software released under the [GNU General Public License v3.0](./LICENSE).

The desktop application bundles third-party open-source software:

- **Electron, Chromium, and Node.js**; redistributed under their respective
  licenses (notices ship alongside the application binary).
- **Bundled libraries** (CodeMirror, Lucide, and others); see the in-app
  **About → Third-Party Licenses** view, generated into `licenses.json` from the
  packages compiled into the app, including those inlined into the renderer
  bundle.

All bundled dependencies use permissive licenses (MIT, ISC, BSD-style, Python-2.0,
BlueOak-1.0.0, WTFPL) that are compatible with GPL-3.0. Each project supplies its
own Astro install; Zephus does not bundle or redistribute Astro.
