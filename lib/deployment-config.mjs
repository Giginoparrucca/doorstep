const base = {
  "regions": [
    "dub1"
  ],
  "rewrites": [
    {
      "source": "/api/guest-chat",
      "destination": "/api/guest"
    }
  ],
  "crons": [
    {
      "path": "/api/ical-sync",
      "schedule": "0 4 * * *"
    },
    {
      "path": "/api/send-arrival-reminders",
      "schedule": "0 5 * * *"
    }
  ],
  "functions": {
    "api/alloggiati.js": {
      "includeFiles": "lib/**",
      "maxDuration": 60
    },
    "api/guest.js": {
      "includeFiles": "lib/**"
    },
    "api/chat.js": {
      "maxDuration": 60
    }
  },
  "buildCommand": "node scripts/build-config.mjs",
  "headers": [
    {
      "source": "/app-config.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store"
        }
      ]
    },
    {
      "source": "/app-bootstrap.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache"
        }
      ]
    }
  ],
  "outputDirectory": "."
};

export function deploymentConfig(env = process.env) {
  const mode = env.APP_ENV || "production";
  if (!["production", "demo"].includes(mode)) throw new Error("Invalid APP_ENV");
  const hint = [env.VERCEL_PROJECT_NAME, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).join(" ");
  if (mode !== "demo" && /(^|[.\s-])demo([.\s-]|$)/i.test(hint)) throw new Error("Demo requires APP_ENV=demo");
  return { ...structuredClone(base), crons: mode === "demo" ? [] : structuredClone(base.crons) };
}
