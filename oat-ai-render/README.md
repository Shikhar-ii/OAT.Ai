# OAT AI Inventory

A static inventory demo for a neighborhood grocery store. It includes the beige-and-forest-green interface, a camera and photo bottle scanner, stock editing, a delivery review demo, an activity history, and rule-based restock suggestions.

## Run locally

Install Node.js 24, then open a terminal in the folder containing `package.json`.

```sh
npm run build
npm run dev
```

Open `http://127.0.0.1:3000`. There are no npm dependencies to install. Use `Ctrl+C` to stop the server. If you need a different local port, copy `.env.example` to `.env` and set `PORT`.

## Deploy on Render

1. Extract the ZIP. Put the contents of the extracted `oat-ai-render` folder at the root of a new Git repository. Commit the files, including `dist/`, and push the repo to your Git provider.
2. In the [Render Dashboard](https://dashboard.render.com/), select **New → Blueprint**. Connect the repository and choose the deployment branch.
3. Review the service and deploy the Blueprint. The supplied `render.yaml` runs the checks and publishes `dist/`.

For manual setup, choose **New → Static Site**, connect the same repository, and use these settings.

| Setting | Value |
| --- | --- |
| Root directory | Repository root |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Environment variables | None |
| Start command | None for a Static Site |

Render serves your site over HTTPS. The Render URL is public unless you add access controls separately. [Render Static Sites](https://render.com/docs/static-sites) · [Render Blueprints](https://render.com/docs/infrastructure-as-code)

## Try the scanner

1. Open the site directly on a phone and choose **Scan bottle**. Allow camera access.
2. Hold one water bottle upright and fully in view, then tap **Scan now**. You can also choose **Upload photo**.
3. Review the result. A successful scan of one bottle shows **Bottle** and **Quantity 1**. **Save count** adds a shelf observation to Activity.

The scanner runs in the browser with the bundled MediaPipe detector and a bottle-specific filter. It counts visible bottles. It cannot identify the liquid inside or reliably distinguish brands. Inventory and activity are saved in local browser storage for the current site URL. Photo attachments and camera frames remain in the browser. The delivery extraction demo uses a prepared sample, and your own receipt attachments require manual entry.

If the camera does not open, check site camera permission and use the direct HTTPS Render URL or upload a photo. A phone opening a local server over plain HTTP may not have camera access. If the deployed scanner fails to load, confirm that `/bottle-scan.mjs` is served with a JavaScript MIME type and the files in `/vision/wasm/` ending in `.wasm` have `application/wasm`.

## Project layout

- `dist/` contains the editable HTML, CSS, and JavaScript and all publishable assets. It includes both MediaPipe WebAssembly builds, the trained filter, model, fonts, and license notices.
- `scripts/` contains the local server and the deployment checks. The build validates syntax, required assets, WebAssembly, and the bundled model checksum.
- `training/` contains the filter training code and annotated image manifest with download URLs and attribution. Training is optional and is separate from deploying the app.
- `render.yaml`, `.node-version`, and `.env.example` provide hosting and local configuration. No keys, credentials, or database setup are required.
