import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseKey &&
    typeof supabaseUrl === "string" &&
    typeof supabaseKey === "string" &&
    supabaseUrl.trim() !== "" &&
    supabaseKey.trim() !== "" &&
    supabaseUrl.startsWith("http")
);

function createFallbackClient() {
  const channelListeners = new Map();
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("clipmaster_local_sync") : null;

  if (bc) {
    bc.onmessage = (event) => {
      const { channelName, payload } = event.data || {};
      const listeners = channelListeners.get(channelName) || [];
      listeners.forEach((cb) => cb(payload));
    };
  }

  return {
    from: (table) => ({
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            try {
              const raw = localStorage.getItem(`clipmaster_${table}_${val}`);
              if (!raw) return { data: null, error: null };
              return { data: JSON.parse(raw), error: null };
            } catch (err) {
              return { data: null, error: err };
            }
          },
        }),
      }),
      upsert: async (record) => {
        try {
          const key = `clipmaster_${table}_${record.id}`;
          localStorage.setItem(key, JSON.stringify(record));
          const channelName = `ws-${record.id}`;
          const payload = { new: record };
          if (bc) {
            bc.postMessage({ channelName, payload });
          }
          const listeners = channelListeners.get(channelName) || [];
          listeners.forEach((cb) => cb(payload));
          return { error: null };
        } catch (err) {
          return { error: err };
        }
      },
    }),
    channel: (name) => {
      return {
        on: (_event, _filter, callback) => {
          if (!channelListeners.has(name)) {
            channelListeners.set(name, []);
          }
          channelListeners.get(name).push(callback);
          return {
            subscribe: () => ({ name, callback }),
          };
        },
      };
    },
    removeChannel: (sub) => {
      if (sub && sub.name && sub.callback) {
        const list = channelListeners.get(sub.name);
        if (list) {
          channelListeners.set(
            sub.name,
            list.filter((cb) => cb !== sub.callback)
          );
        }
      }
    },
  };
}

export const sb = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : createFallbackClient();
