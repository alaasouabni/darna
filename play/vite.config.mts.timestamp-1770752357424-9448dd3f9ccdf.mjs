// vite.config.mts
import { basename } from "path";
import fs from "fs";
import { execSync } from "child_process";
import { defineConfig, loadEnv } from "file:///usr/src/app/play/node_modules/vite/dist/node/index.js";
import { svelte } from "file:///usr/src/app/play/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import { sveltePreprocess } from "file:///usr/src/app/play/node_modules/svelte-preprocess/dist/index.js";
import legacy from "file:///usr/src/app/play/node_modules/@vitejs/plugin-legacy/dist/index.mjs";
import { sentryVitePlugin } from "file:///usr/src/app/node_modules/@sentry/vite-plugin/dist/esm/index.mjs";
import Icons from "file:///usr/src/app/node_modules/unplugin-icons/dist/vite.js";
import tsconfigPaths from "file:///usr/src/app/play/node_modules/vite-tsconfig-paths/dist/index.mjs";
import { nodePolyfills } from "file:///usr/src/app/node_modules/vite-plugin-node-polyfills/dist/index.js";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildHash = resolveBuildHash(env);
  const config = {
    server: {
      host: "0.0.0.0",
      port: 8080,
      hmr: {
        // workaround for development in docker
        clientPort: 80
      },
      watch: {
        ignored: ["./src/pusher"]
      }
    },
    build: {
      sourcemap: env.GENERATE_SOURCEMAP !== "false",
      outDir: "./dist/public",
      rollupOptions: {
        plugins: [mediapipe_workaround()]
        // external: ["@mediapipe/tasks-vision"],
        //plugins: [inject({ Buffer: ["buffer/", "Buffer"] })],
      },
      assetsInclude: ["**/*.tflite", "**/*.wasm"]
    },
    plugins: [
      nodePolyfills({
        include: ["events", "buffer"],
        globals: {
          Buffer: true
        }
      }),
      emitVersionPlugin(buildHash),
      svelte({
        preprocess: sveltePreprocess(),
        onwarn(warning, defaultHandler) {
          if (warning.code === "a11y-click-events-have-key-events") return;
          if (warning.code === "security-anchor-rel-noreferrer") return;
          if (warning.code === "Unknown at rule @container (css)") return;
          if (warning.message.includes("Unknown at rule @container")) return;
          if (defaultHandler) {
            defaultHandler(warning);
          }
        }
      }),
      Icons({
        compiler: "svelte"
      }),
      // Conditional plugin inclusion
      ...env.DISABLE_LEGACY_BROWSERS === "true" ? [] : [
        legacy({
          //targets: ['defaults', 'not IE 11', 'iOS > 14.3']
          // Structured clone is needed for Safari < 15.4
          polyfills: ["web.structured-clone"],
          modernPolyfills: ["web.structured-clone"]
        })
      ],
      tsconfigPaths()
    ],
    resolve: {
      alias: {
        events: "events"
      }
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./tests/setup/vitest.setup.ts"],
      coverage: {
        all: true,
        include: ["src/*.ts", "src/**/*.ts"],
        exclude: ["src/i18n", "src/enum"]
      }
    },
    optimizeDeps: {
      include: ["olm"],
      exclude: ["svelte-modals"],
      esbuildOptions: {
        define: {
          global: "globalThis"
        }
      }
    }
  };
  if (env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN && env.SENTRY_RELEASE && env.SENTRY_ENVIRONMENT) {
    console.info("Sentry plugin enabled");
    config.plugins.push(
      sentryVitePlugin({
        url: env.SENTRY_URL || "https://sentry.io/",
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        // Specify the directory containing build artifacts
        sourcemaps: {
          assets: "./dist/public/**"
        },
        // Auth tokens can be obtained from https://sentry.io/settings/account/api/auth-tokens/
        // and needs the `project:releases` and `org:read` scopes
        authToken: env.SENTRY_AUTH_TOKEN,
        // Optionally uncomment the line below to override automatic release name detection
        release: {
          name: env.SENTRY_RELEASE,
          deploy: {
            env: env.SENTRY_ENVIRONMENT
          },
          finalize: true
        }
      })
    );
  } else {
    console.info("Sentry plugin disabled");
  }
  return config;
});
function mediapipe_workaround() {
  return {
    name: "mediapipe_workaround",
    load(id) {
      if (basename(id) === "selfie_segmentation.js") {
        let code = fs.readFileSync(id, "utf-8");
        code += "exports.SelfieSegmentation = SelfieSegmentation;";
        return { code };
      } else {
        return null;
      }
    }
  };
}
function resolveBuildHash(env) {
  if (env.VITE_BUILD_HASH) {
    return env.VITE_BUILD_HASH;
  }
  if (process.env.SENTRY_RELEASE) {
    return process.env.SENTRY_RELEASE;
  }
  if (process.env.GIT_HASH) {
    return process.env.GIT_HASH;
  }
  try {
    if (fs.existsSync(".git")) {
      return execSync("git rev-parse --short HEAD").toString().trim();
    }
  } catch {
  }
  return (/* @__PURE__ */ new Date()).toISOString();
}
function emitVersionPlugin(buildHash) {
  return {
    name: "emit-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          {
            hash: buildHash,
            builtAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          null,
          2
        )
      });
    }
  };
}
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcubXRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL3Vzci9zcmMvYXBwL3BsYXlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi91c3Ivc3JjL2FwcC9wbGF5L3ZpdGUuY29uZmlnLm10c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vdXNyL3NyYy9hcHAvcGxheS92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgeyBiYXNlbmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHsgc3ZlbHRlIH0gZnJvbSBcIkBzdmVsdGVqcy92aXRlLXBsdWdpbi1zdmVsdGVcIjtcclxuaW1wb3J0IHsgc3ZlbHRlUHJlcHJvY2VzcyB9IGZyb20gXCJzdmVsdGUtcHJlcHJvY2Vzc1wiO1xyXG5pbXBvcnQgbGVnYWN5IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1sZWdhY3lcIjtcclxuaW1wb3J0IHsgc2VudHJ5Vml0ZVBsdWdpbiB9IGZyb20gXCJAc2VudHJ5L3ZpdGUtcGx1Z2luXCI7XHJcbmltcG9ydCBJY29ucyBmcm9tIFwidW5wbHVnaW4taWNvbnMvdml0ZVwiO1xyXG5pbXBvcnQgdHNjb25maWdQYXRocyBmcm9tIFwidml0ZS10c2NvbmZpZy1wYXRoc1wiO1xyXG5pbXBvcnQgeyBub2RlUG9seWZpbGxzIH0gZnJvbSBcInZpdGUtcGx1Z2luLW5vZGUtcG9seWZpbGxzXCI7XHJcblxyXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XG4gICAgLy8gTG9hZCBlbnYgZmlsZSBiYXNlZCBvbiBgbW9kZWAgaW4gdGhlIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXHJcbiAgICAvLyBTZXQgdGhlIHRoaXJkIHBhcmFtZXRlciB0byAnJyB0byBsb2FkIGFsbCBlbnYgcmVnYXJkbGVzcyBvZiB0aGUgYFZJVEVfYCBwcmVmaXguXHJcbiAgICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIHByb2Nlc3MuY3dkKCksIFwiXCIpO1xyXG4gICAgY29uc3QgYnVpbGRIYXNoID0gcmVzb2x2ZUJ1aWxkSGFzaChlbnYpO1xuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgICAgc2VydmVyOiB7XHJcbiAgICAgICAgICAgIGhvc3Q6IFwiMC4wLjAuMFwiLFxyXG4gICAgICAgICAgICBwb3J0OiA4MDgwLFxyXG4gICAgICAgICAgICBobXI6IHtcclxuICAgICAgICAgICAgICAgIC8vIHdvcmthcm91bmQgZm9yIGRldmVsb3BtZW50IGluIGRvY2tlclxyXG4gICAgICAgICAgICAgICAgY2xpZW50UG9ydDogODAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHdhdGNoOiB7XHJcbiAgICAgICAgICAgICAgICBpZ25vcmVkOiBbXCIuL3NyYy9wdXNoZXJcIl0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBidWlsZDoge1xyXG4gICAgICAgICAgICBzb3VyY2VtYXA6IGVudi5HRU5FUkFURV9TT1VSQ0VNQVAgIT09IFwiZmFsc2VcIixcclxuICAgICAgICAgICAgb3V0RGlyOiBcIi4vZGlzdC9wdWJsaWNcIixcclxuICAgICAgICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgcGx1Z2luczogW21lZGlhcGlwZV93b3JrYXJvdW5kKCldLFxyXG4gICAgICAgICAgICAgICAgLy8gZXh0ZXJuYWw6IFtcIkBtZWRpYXBpcGUvdGFza3MtdmlzaW9uXCJdLFxyXG4gICAgICAgICAgICAgICAgLy9wbHVnaW5zOiBbaW5qZWN0KHsgQnVmZmVyOiBbXCJidWZmZXIvXCIsIFwiQnVmZmVyXCJdIH0pXSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgYXNzZXRzSW5jbHVkZTogW1wiKiovKi50ZmxpdGVcIiwgXCIqKi8qLndhc21cIl0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwbHVnaW5zOiBbXG4gICAgICAgICAgICBub2RlUG9seWZpbGxzKHtcbiAgICAgICAgICAgICAgICBpbmNsdWRlOiBbXCJldmVudHNcIiwgXCJidWZmZXJcIl0sXG4gICAgICAgICAgICAgICAgZ2xvYmFsczoge1xuICAgICAgICAgICAgICAgICAgICBCdWZmZXI6IHRydWUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgZW1pdFZlcnNpb25QbHVnaW4oYnVpbGRIYXNoKSxcbiAgICAgICAgICAgIHN2ZWx0ZSh7XG4gICAgICAgICAgICAgICAgcHJlcHJvY2Vzczogc3ZlbHRlUHJlcHJvY2VzcygpLFxyXG4gICAgICAgICAgICAgICAgb253YXJuKHdhcm5pbmcsIGRlZmF1bHRIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZG9uJ3Qgd2FybiBvbjpcclxuICAgICAgICAgICAgICAgICAgICBpZiAod2FybmluZy5jb2RlID09PSBcImExMXktY2xpY2stZXZlbnRzLWhhdmUta2V5LWV2ZW50c1wiKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHdhcm5pbmcuY29kZSA9PT0gXCJzZWN1cml0eS1hbmNob3ItcmVsLW5vcmVmZXJyZXJcIikgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh3YXJuaW5nLmNvZGUgPT09IFwiVW5rbm93biBhdCBydWxlIEBjb250YWluZXIgKGNzcylcIikgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh3YXJuaW5nLm1lc3NhZ2UuaW5jbHVkZXMoXCJVbmtub3duIGF0IHJ1bGUgQGNvbnRhaW5lclwiKSkgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBoYW5kbGUgYWxsIG90aGVyIHdhcm5pbmdzIG5vcm1hbGx5XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRlZmF1bHRIYW5kbGVyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHRIYW5kbGVyKHdhcm5pbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICBJY29ucyh7XHJcbiAgICAgICAgICAgICAgICBjb21waWxlcjogXCJzdmVsdGVcIixcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIC8vIENvbmRpdGlvbmFsIHBsdWdpbiBpbmNsdXNpb25cclxuICAgICAgICAgICAgLi4uKGVudi5ESVNBQkxFX0xFR0FDWV9CUk9XU0VSUyA9PT0gXCJ0cnVlXCJcclxuICAgICAgICAgICAgICAgID8gW11cclxuICAgICAgICAgICAgICAgIDogW1xyXG4gICAgICAgICAgICAgICAgICAgICAgbGVnYWN5KHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAvL3RhcmdldHM6IFsnZGVmYXVsdHMnLCAnbm90IElFIDExJywgJ2lPUyA+IDE0LjMnXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFN0cnVjdHVyZWQgY2xvbmUgaXMgbmVlZGVkIGZvciBTYWZhcmkgPCAxNS40XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcG9seWZpbGxzOiBbXCJ3ZWIuc3RydWN0dXJlZC1jbG9uZVwiXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBtb2Rlcm5Qb2x5ZmlsbHM6IFtcIndlYi5zdHJ1Y3R1cmVkLWNsb25lXCJdLFxyXG4gICAgICAgICAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgICAgIF0pLFxyXG4gICAgICAgICAgICB0c2NvbmZpZ1BhdGhzKCksXHJcbiAgICAgICAgXSxcclxuICAgICAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgICAgIGFsaWFzOiB7XHJcbiAgICAgICAgICAgICAgICBldmVudHM6IFwiZXZlbnRzXCIsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0ZXN0OiB7XHJcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBcImpzZG9tXCIsXHJcbiAgICAgICAgICAgIGdsb2JhbHM6IHRydWUsXHJcbiAgICAgICAgICAgIHNldHVwRmlsZXM6IFtcIi4vdGVzdHMvc2V0dXAvdml0ZXN0LnNldHVwLnRzXCJdLFxyXG4gICAgICAgICAgICBjb3ZlcmFnZToge1xyXG4gICAgICAgICAgICAgICAgYWxsOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZTogW1wic3JjLyoudHNcIiwgXCJzcmMvKiovKi50c1wiXSxcclxuICAgICAgICAgICAgICAgIGV4Y2x1ZGU6IFtcInNyYy9pMThuXCIsIFwic3JjL2VudW1cIl0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBvcHRpbWl6ZURlcHM6IHtcclxuICAgICAgICAgICAgaW5jbHVkZTogW1wib2xtXCJdLFxyXG4gICAgICAgICAgICBleGNsdWRlOiBbXCJzdmVsdGUtbW9kYWxzXCJdLFxyXG4gICAgICAgICAgICBlc2J1aWxkT3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgZGVmaW5lOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsOiBcImdsb2JhbFRoaXNcIixcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgIH07XG5cclxuICAgIGlmIChlbnYuU0VOVFJZX09SRyAmJiBlbnYuU0VOVFJZX1BST0pFQ1QgJiYgZW52LlNFTlRSWV9BVVRIX1RPS0VOICYmIGVudi5TRU5UUllfUkVMRUFTRSAmJiBlbnYuU0VOVFJZX0VOVklST05NRU5UKSB7XHJcbiAgICAgICAgY29uc29sZS5pbmZvKFwiU2VudHJ5IHBsdWdpbiBlbmFibGVkXCIpO1xyXG4gICAgICAgIGNvbmZpZy5wbHVnaW5zLnB1c2goXHJcbiAgICAgICAgICAgIHNlbnRyeVZpdGVQbHVnaW4oe1xyXG4gICAgICAgICAgICAgICAgdXJsOiBlbnYuU0VOVFJZX1VSTCB8fCBcImh0dHBzOi8vc2VudHJ5LmlvL1wiLFxyXG4gICAgICAgICAgICAgICAgb3JnOiBlbnYuU0VOVFJZX09SRyxcclxuICAgICAgICAgICAgICAgIHByb2plY3Q6IGVudi5TRU5UUllfUFJPSkVDVCxcclxuICAgICAgICAgICAgICAgIC8vIFNwZWNpZnkgdGhlIGRpcmVjdG9yeSBjb250YWluaW5nIGJ1aWxkIGFydGlmYWN0c1xyXG4gICAgICAgICAgICAgICAgc291cmNlbWFwczoge1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2V0czogXCIuL2Rpc3QvcHVibGljLyoqXCIsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgLy8gQXV0aCB0b2tlbnMgY2FuIGJlIG9idGFpbmVkIGZyb20gaHR0cHM6Ly9zZW50cnkuaW8vc2V0dGluZ3MvYWNjb3VudC9hcGkvYXV0aC10b2tlbnMvXHJcbiAgICAgICAgICAgICAgICAvLyBhbmQgbmVlZHMgdGhlIGBwcm9qZWN0OnJlbGVhc2VzYCBhbmQgYG9yZzpyZWFkYCBzY29wZXNcclxuICAgICAgICAgICAgICAgIGF1dGhUb2tlbjogZW52LlNFTlRSWV9BVVRIX1RPS0VOLFxyXG4gICAgICAgICAgICAgICAgLy8gT3B0aW9uYWxseSB1bmNvbW1lbnQgdGhlIGxpbmUgYmVsb3cgdG8gb3ZlcnJpZGUgYXV0b21hdGljIHJlbGVhc2UgbmFtZSBkZXRlY3Rpb25cclxuICAgICAgICAgICAgICAgIHJlbGVhc2U6IHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBlbnYuU0VOVFJZX1JFTEVBU0UsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVwbG95OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudjogZW52LlNFTlRSWV9FTlZJUk9OTUVOVCxcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbmFsaXplOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICApO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmluZm8oXCJTZW50cnkgcGx1Z2luIGRpc2FibGVkXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbmZpZztcclxufSk7XG5cclxuLy8gdXNlIHRvIGZpeCB0aGUgYnVpbGQgaXNzdWUgd2l0aCBtZWRpYXBpcGUgPT0+IGh0dHBzOi8vZ2l0aHViLmNvbS90ZW5zb3JmbG93L3RmanMvaXNzdWVzLzcxNjVcclxuLy8gVE9ETzogcmVtb3ZlIHRoaXMgd2hlbiB3ZSBtaWdyYXRlIHRvIG1lZGlhcGlwZS90YXNrcy12aXNpb25cclxuZnVuY3Rpb24gbWVkaWFwaXBlX3dvcmthcm91bmQoKSB7XG4gICAgcmV0dXJuIHtcclxuICAgICAgICBuYW1lOiBcIm1lZGlhcGlwZV93b3JrYXJvdW5kXCIsXHJcbiAgICAgICAgbG9hZChpZDogc3RyaW5nKSB7XHJcbiAgICAgICAgICAgIGlmIChiYXNlbmFtZShpZCkgPT09IFwic2VsZmllX3NlZ21lbnRhdGlvbi5qc1wiKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgY29kZSA9IGZzLnJlYWRGaWxlU3luYyhpZCwgXCJ1dGYtOFwiKTtcclxuICAgICAgICAgICAgICAgIGNvZGUgKz0gXCJleHBvcnRzLlNlbGZpZVNlZ21lbnRhdGlvbiA9IFNlbGZpZVNlZ21lbnRhdGlvbjtcIjtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IGNvZGUgfTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUJ1aWxkSGFzaChlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBzdHJpbmcge1xuICAgIGlmIChlbnYuVklURV9CVUlMRF9IQVNIKSB7XG4gICAgICAgIHJldHVybiBlbnYuVklURV9CVUlMRF9IQVNIO1xuICAgIH1cbiAgICBpZiAocHJvY2Vzcy5lbnYuU0VOVFJZX1JFTEVBU0UpIHtcbiAgICAgICAgcmV0dXJuIHByb2Nlc3MuZW52LlNFTlRSWV9SRUxFQVNFO1xuICAgIH1cbiAgICBpZiAocHJvY2Vzcy5lbnYuR0lUX0hBU0gpIHtcbiAgICAgICAgcmV0dXJuIHByb2Nlc3MuZW52LkdJVF9IQVNIO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhcIi5naXRcIikpIHtcbiAgICAgICAgICAgIHJldHVybiBleGVjU3luYyhcImdpdCByZXYtcGFyc2UgLS1zaG9ydCBIRUFEXCIpLnRvU3RyaW5nKCkudHJpbSgpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGlnbm9yZVxuICAgIH1cbiAgICByZXR1cm4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBlbWl0VmVyc2lvblBsdWdpbihidWlsZEhhc2g6IHN0cmluZykge1xuICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IFwiZW1pdC12ZXJzaW9uLWpzb25cIixcbiAgICAgICAgZ2VuZXJhdGVCdW5kbGUoKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRGaWxlKHtcbiAgICAgICAgICAgICAgICB0eXBlOiBcImFzc2V0XCIsXG4gICAgICAgICAgICAgICAgZmlsZU5hbWU6IFwidmVyc2lvbi5qc29uXCIsXG4gICAgICAgICAgICAgICAgc291cmNlOiBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgaGFzaDogYnVpbGRIYXNoLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnVpbHRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAgICAgICAyXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LFxuICAgIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXVPLFNBQVMsZ0JBQWdCO0FBQ2hRLE9BQU8sUUFBUTtBQUNmLFNBQVMsZ0JBQWdCO0FBQ3pCLFNBQVMsY0FBYyxlQUFlO0FBQ3RDLFNBQVMsY0FBYztBQUN2QixTQUFTLHdCQUF3QjtBQUNqQyxPQUFPLFlBQVk7QUFDbkIsU0FBUyx3QkFBd0I7QUFDakMsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sbUJBQW1CO0FBQzFCLFNBQVMscUJBQXFCO0FBRzlCLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBR3RDLFFBQU0sTUFBTSxRQUFRLE1BQU0sUUFBUSxJQUFJLEdBQUcsRUFBRTtBQUMzQyxRQUFNLFlBQVksaUJBQWlCLEdBQUc7QUFDdEMsUUFBTSxTQUFTO0FBQUEsSUFDWCxRQUFRO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUEsTUFDTixLQUFLO0FBQUE7QUFBQSxRQUVELFlBQVk7QUFBQSxNQUNoQjtBQUFBLE1BQ0EsT0FBTztBQUFBLFFBQ0gsU0FBUyxDQUFDLGNBQWM7QUFBQSxNQUM1QjtBQUFBLElBQ0o7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNILFdBQVcsSUFBSSx1QkFBdUI7QUFBQSxNQUN0QyxRQUFRO0FBQUEsTUFDUixlQUFlO0FBQUEsUUFDWCxTQUFTLENBQUMscUJBQXFCLENBQUM7QUFBQTtBQUFBO0FBQUEsTUFHcEM7QUFBQSxNQUNBLGVBQWUsQ0FBQyxlQUFlLFdBQVc7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
