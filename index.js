require("dotenv").config();
const { Client } = require("discord.js-selfbot-v13");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveEnvPath() {
  const args = process.argv.slice(2);
  const envFlagIndex = args.findIndex(
    (arg) => arg === "--env" || arg === "-e" || arg === "--config"
  );

  let envFile =
    process.env.ENV_FILE || process.env.CONFIG_FILE || process.env.CONFIG;

  if (envFlagIndex !== -1 && args[envFlagIndex + 1]) {
    envFile = args[envFlagIndex + 1];
  }

  if (!envFile) {
    return path.join(__dirname, ".env");
  }

  return path.isAbsolute(envFile) ? envFile : path.join(__dirname, envFile);
}

function loadEnvConfig() {
  const resolvedPath = resolveEnvPath();

  try {
    const raw = fs.readFileSync(resolvedPath);
    const parsed = dotenv.parse(raw);
    console.log(`[INFO] Dang dung env: ${resolvedPath}`);
    return { env: parsed, envPath: resolvedPath };
  } catch (error) {
    console.warn(
      `[WARN] Khong doc duoc file env: ${resolvedPath} (${error.message})`
    );
    return { env: {}, envPath: resolvedPath, error };
  }
}

const { env: ENV } = loadEnvConfig();

function log(message) {
  const time = new Date().toISOString();
  const logMessage = `[${time}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync("bot_logs.txt", logMessage + "\n");
}

async function joinVoice(client, guildId, voiceChannelId, group, options = {}) {
  try {
    const channel = await client.channels.fetch(voiceChannelId);
    const {
      selfDeaf = false,
      selfMute = false,
      readyTimeoutMs = 15000,
      onError,
    } = options;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      group,
      selfDeaf, // tat loa theo config
      selfMute, // mute theo config
    });

    log(`[${client.user.tag}] Join voice requested (group=${group})`);

    // Clean voice logs
    const IMPORTANT = new Set(["ready", "disconnected", "destroyed"]);
    let lastPair = "";
    let lastLogAt = 0;

    connection.on("stateChange", (oldState, newState) => {
      const from = oldState.status;
      const to = newState.status;

      if (from === to) return;
      if (!IMPORTANT.has(from) && !IMPORTANT.has(to)) return;

      const now = Date.now();
      const pair = `${from}->${to}`;

      if (pair === lastPair && now - lastLogAt < 1500) return;
      lastPair = pair;
      lastLogAt = now;
      if (to === "ready") {
        log(`[${client.user.tag}] Voice READY (group=${group})`);
      } else if (to === "disconnected") {
        log(`[${client.user.tag}] Voice DISCONNECTED (group=${group})`);
      } else if (to === "destroyed") {
        log(`[${client.user.tag}] Voice DESTROYED (group=${group})`);
      } else {
        log(`[${client.user.tag}] Voice: ${from} -> ${to} (group=${group})`);
      }
    });

    connection.on("error", (error) => {
      log(
        `[${client.user.tag}] Voice ERROR (group=${group}): ${error?.stack || error}`
      );
      if (onError) onError(`error: ${error?.message || error}`);
    });

    if (readyTimeoutMs && readyTimeoutMs > 0) {
      try {
        await entersState(
          connection,
          VoiceConnectionStatus.Ready,
          readyTimeoutMs
        );
      } catch (error) {
        log(
          `[${client.user.tag}] Voice READY timeout (group=${group}). Will retry.`
        );
        try {
          connection.destroy();
        } catch (_) {
          // ignore destroy errors
        }
        if (onError) onError("ready-timeout");
        return null;
      }
    }

    return connection;
  } catch (err) {
    log(
      `[${client.user?.tag || "UNKNOWN"}] Lỗi tham gia voice: ${err?.stack || err}`
    );
    if (options?.onError) options.onError("exception");
    return null;
  }
}

async function sendVoiceChat(client, voiceChannelId, content) {
  const channel = await client.channels.fetch(voiceChannelId);

  if (!channel || !channel.isText()) {
    console.log("Channel không hỗ trợ chat");
    return;
  }

  await channel.send(content);
  console.log(`[${client.user.tag}] Đã gửi chat trong voice`);
}


function parseBooleanEnv(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseIntervalEnv(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  if (/^[\d\s+\-*/().]+$/.test(raw)) {
    try {
      const result = Function(`"use strict"; return (${raw});`)();
      if (Number.isFinite(result)) return result;
    } catch (error) {
      log(`[WARN] Không parse được INTERVAL: ${raw}`);
    }
  }

  return defaultValue;
}

const VOICE_READY_TIMEOUT_MS = parseIntervalEnv(
  ENV.VOICE_READY_TIMEOUT_MS,
  15000
);
const VOICE_RETRY_BASE_MS = parseIntervalEnv(ENV.VOICE_RETRY_BASE_MS, 5000);
const VOICE_RETRY_MAX_MS = parseIntervalEnv(ENV.VOICE_RETRY_MAX_MS, 60000);
const VOICE_RETRY_JITTER_MS = parseIntervalEnv(
  ENV.VOICE_RETRY_JITTER_MS,
  1000
);
const VOICE_CONNECT_STAGGER_MS = parseIntervalEnv(
  ENV.VOICE_CONNECT_STAGGER_MS,
  2000
);

function buildAccount(index, env) {
  const hasSuffix = index !== null && index !== undefined;
  const suffix = hasSuffix ? `_${index}` : "";
  const label = hasSuffix ? index : "default";

  return {
    index: label,
    token: env[`TOKEN${suffix}`],
    guildId: env[`GUILD_ID${suffix}`],
    voiceChannelId: env[`VOICE_CHANNEL_ID${suffix}`],
    sendChat: parseBooleanEnv(env[`SEND_CHAT${suffix}`], true),
    intervalMs: parseIntervalEnv(
      env[`INTERVAL${suffix}`],
      11 * 60 * 60 * 1000
    ),
    playlist: env[`PLAYLIST${suffix}`] || "m!p https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    selfDeaf: parseBooleanEnv(env[`SELFDEAF${suffix}`], false),
    selfMute: parseBooleanEnv(env[`SELFMUTE${suffix}`], false),
  };
}

function getAccountIndices(env) {
  const indices = new Set();

  for (const key of Object.keys(env)) {
    const match = key.match(/^TOKEN_(\d+)$/);
    if (match) {
      indices.add(Number(match[1]));
    }
  }

  if (indices.size > 0) {
    return Array.from(indices).sort((a, b) => a - b);
  }

  if (env.TOKEN || env.GUILD_ID || env.VOICE_CHANNEL_ID) {
    return [null];
  }

  return [];
}

const accounts = getAccountIndices(ENV)
  .map((index) => buildAccount(index, ENV))
  .filter((account) => account.token && account.guildId && account.voiceChannelId);

if (accounts.length === 0) {
  log("[WARN] Khong tim thay account hop le. Kiem tra file env.");
}

const tokenGroups = new Map();

for (const account of accounts) {
  if (!tokenGroups.has(account.token)) {
    tokenGroups.set(account.token, { token: account.token, accounts: [] });
  }
  const group = tokenGroups.get(account.token);
  if (group.accounts.length > 0) {
    log(
      `[WARN] Trung TOKEN cho account ${account.index}. Bo qua account nay de tranh mat ket noi.`
    );
    continue;
  }

  group.accounts.push(account);
}

async function startAccount(client, account, groupPrefix) {
  const group = `${groupPrefix}-${account.index}`;
  let connection = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let connecting = false;
  let chatStarted = false;

  const scheduleReconnect = (reason) => {
    if (reconnectTimer) return;

    const baseDelay = Math.min(
      VOICE_RETRY_BASE_MS * Math.pow(2, reconnectAttempt),
      VOICE_RETRY_MAX_MS
    );
    const jitter = Math.floor(Math.random() * VOICE_RETRY_JITTER_MS);
    const waitMs = baseDelay + jitter;

    reconnectAttempt += 1;

    log(
      `[${client.user.tag}] Reconnect in ${waitMs}ms (group=${group}, reason=${reason})`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, waitMs);
  };

  const connect = async () => {
    if (connecting) return;
    connecting = true;

    try {
      if (connection) {
        try {
          connection.destroy();
        } catch (_) {
          // ignore destroy errors
        }
        connection = null;
      }

      connection = await joinVoice(
        client,
        account.guildId,
        account.voiceChannelId,
        group,
        {
          selfDeaf: account.selfDeaf,
          selfMute: account.selfMute,
          readyTimeoutMs: VOICE_READY_TIMEOUT_MS,
          onError: scheduleReconnect,
        }
      );

      if (!connection) {
        scheduleReconnect("join-failed");
        return;
      }

      reconnectAttempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      connection.on("stateChange", (oldState, newState) => {
        if (
          newState.status === VoiceConnectionStatus.Disconnected ||
          newState.status === VoiceConnectionStatus.Destroyed
        ) {
          scheduleReconnect(`state-${newState.status}`);
        }
      });

      if (!chatStarted) {
        chatStarted = true;

        if (account.sendChat) {
          try {
            await sendVoiceChat(client, account.voiceChannelId, "m!leave");
            await sleep(10_000);
            await sendVoiceChat(client, account.voiceChannelId, account.playlist);
            await sleep(10_000);
            await sendVoiceChat(client, account.voiceChannelId, "m!lq");
          } catch (e) {
            console.error(`[${client.user.tag}] Initial chat error`, e);
          }
        }

        let isTicking = false;

        setInterval(async () => {
          if (isTicking) return;
          isTicking = true;

          try {
            // interval: leave -> play -> loop queue
            if (account.sendChat) {
              await sendVoiceChat(client, account.voiceChannelId, "m!leave");
              await sleep(10_000);

              await sendVoiceChat(client, account.voiceChannelId, account.playlist);
              await sleep(10_000);

              await sendVoiceChat(client, account.voiceChannelId, "m!lq");
            }
          } catch (e) {
            console.error(`[${client.user.tag}] Interval chat error`, e);
          } finally {
            isTicking = false;
          }
        }, account.intervalMs);
      }
    } finally {
      connecting = false;
    }
  };

  if (VOICE_CONNECT_STAGGER_MS > 0) {
    const staggerMs = Math.floor(Math.random() * VOICE_CONNECT_STAGGER_MS);
    if (staggerMs > 0) {
      log(`[${client.user.tag}] Stagger join ${staggerMs}ms (group=${group})`);
      await sleep(staggerMs);
    }
  }

  await connect();
}

tokenGroups.forEach((group) => {
  const client = new Client();

  client.on("ready", async () => {
    log(`${client.user.tag} đã đăng nhập thành công!`);

    const groupPrefix = `acc-${client.user.id}`;

    for (const account of group.accounts) {
      await startAccount(client, account, groupPrefix);
    }
  });

  client.on("error", (error) => {
    log(`[ERROR] ${client.user?.tag || "UNKNOWN"}: ${error?.stack || error}`);
  });

  client.login(group.token);
});

