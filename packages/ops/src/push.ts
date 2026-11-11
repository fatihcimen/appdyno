import { PUSH_TYPES } from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, noApp } from './policy.js';
import { ActionOut } from './schemas.js';

/** The answer, and with no type the types this device takes: each with its route and template, or why not. */
const PushOut = ActionOut.extend({
  types: z
    .array(
      z.union([
        z.object({
          type: z.string(),
          route: z.string(),
          fields: z.array(z.string()),
          template: z.string(),
          tokens: z.array(z.string()).optional(),
        }),
        z.object({ type: z.string(), why: z.string() }),
      ]),
    )
    .optional(),
});
import { Read } from './step-schemas.js';
import { ACT, defineOp, reply, ToolError } from './tool.js';

/** APNs' limit for a payload, which a simulator's push keeps too. */
const PAYLOAD_BYTES = 4_096;

/** A raw payload as the platform takes it: an object of JSON, no larger than a push may be. */
function payloadOf(text: string) {
  if (Buffer.byteLength(text) > PAYLOAD_BYTES)
    throw new ToolError(`a payload is ${PAYLOAD_BYTES} bytes at most`, 'INVALID_ARGUMENT');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToolError('payload is JSON: an object', 'INVALID_ARGUMENT');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ToolError('payload is JSON: an object', 'INVALID_ARGUMENT');
  return parsed as Record<string, unknown>;
}

export function pushOps(ctx: ServerContext, { changing, afterChange }: Answers) {
  return [
    defineOp({
      name: 'push',
      title: 'Push notification',
      description:
        'Push notification, remote notification, Live Activity, rich notification, FCM, APNs, to the app. No type lists what this device takes, and how.',
      input: z
        .object({
          app: z.string().max(200).optional(),
          type: z.string().max(40).optional(),
          title: z.string().max(200).optional(),
          body: z.string().max(2_000).optional(),
          image: z.string().max(2_000).optional(),
          data: z.record(z.string(), z.string()).optional(),
          payload: z
            .string()
            .max(PAYLOAD_BYTES * 2)
            .optional()
            .describe("APNs' or FCM's JSON"),
          read: Read,
        })
        .strict(),
      output: PushOut,
      annotations: ACT,
      run: async ({ app, type, title, body, image, data, payload, read }) => {
        const s = await ctx.session();
        // through the allow list for a listing too: the routes are read from the app's build
        const named = app ?? s.appId;
        const pkg = named ? checkApp(ctx.policy, named) : undefined;
        const routes = await s.device.events.pushRoutes(pkg);
        const given = Object.entries({ title, body, image, data }).flatMap(([k, v]) =>
          v ? [k] : [],
        );
        if (!type && given.length === 0 && !payload) {
          const t = routes
            .map((r) => `${r.type}: ${'route' in r ? r.route : `no: ${r.why}`}`)
            .join('\n');
          return reply(t, { done: t, screen: 'none', warnings: [], types: routes });
        }
        const works = routes.flatMap((r) => ('route' in r ? [r.type] : []));
        const goHere =
          works.length > 0
            ? `type ${works.join(', ')} still ${works.length === 1 ? 'works' : 'work'} here`
            : undefined;
        // a title or body is what an alert shows: a message is never dropped for the list of types
        const kind = type ?? (title || body ? 'alert' : undefined);
        if (!kind)
          throw new ToolError(
            `${[...given, ...(payload ? ['payload'] : [])].join(', ')} with no type: give one, as only a title or body goes as alert by itself`,
            'INVALID_ARGUMENT',
            goHere,
          );
        const route = routes.find((r) => r.type === kind);
        if (!route)
          throw new ToolError(`type: ${PUSH_TYPES.join(', ')}, not ${kind}`, 'INVALID_ARGUMENT');
        if ('why' in route)
          throw new ToolError(
            type
              ? route.why
              : `a title or body with no type goes as alert, and alert cannot go here: ${route.why}`,
            'UNSUPPORTED',
            goHere,
          );
        const extra = given.filter((f) => !(route.fields as string[]).includes(f));
        if (extra.length > 0)
          throw new ToolError(
            `${kind} here takes ${route.fields.join(', ') || 'payload alone'}: not ${extra.join(', ')}`,
            'INVALID_ARGUMENT',
          );
        if (payload && given.length > 0)
          throw new ToolError(
            'payload replaces the fields: give one or the other',
            'INVALID_ARGUMENT',
          );
        if (!pkg) throw noApp();
        const { result: said, was } = await changing(s, () =>
          s.device.events.push(pkg, {
            type: route.type,
            ...(title && { title }),
            ...(body && { body }),
            ...(image && { image }),
            ...(data && { data }),
            ...(payload && { payload: payloadOf(payload) }),
          }),
        );
        return afterChange(s, was, type ? said : `${said} (as alert: no type was given)`, read);
      },
    }),
  ];
}
