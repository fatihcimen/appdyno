import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { DESTRUCTIVE, READ, SAVES } from '../tool.js';

export const readLogs = ({ logs, crashes }: Pick<Pieces, 'logs' | 'crashes'>) =>
  mergeOp({
    name: 'read_logs',
    title: 'Logs and crashes',
    description:
      "Read the app's log, or with source crashes its crash, ANR and exit reports. Returns, for the log, its own lines (logcat on Android), newest last, secrets redacted; level, contains, limit (200). For crashes: a bounded summary and each report's file; limit (5), symbols. An action the app died under already says why: this is for more. Requests: capture_network.",
    input: z
      .object({
        source: z.enum(['app', 'crashes']).default('app'),
        ...logs.input.omit({ maxLines: true }).shape,
        ...crashes.input.omit({ since: true }).shape,
        limit: z.number().int().optional(),
      })
      .strict(),
    annotations: READ,
    parts: [logs, crashes],
    pick: ({ source, limit, ...a }) =>
      source === 'crashes'
        ? [crashes, { ...a, limit }]
        : [logs, { ...a, maxLines: limit }, { maxLines: 'limit' }],
  });

export const checkScreen = ({ audit, visual }: Pick<Pieces, 'audit' | 'visual'>) =>
  mergeOp({
    name: 'check_screen',
    title: 'Check the whole screen',
    description:
      'Check the whole screen. accessibility: an accessibility audit of contrast, touch targets, labels, reading order (types, maxIssues). visual: a visual regression test against the image name in dir, failing with CHECK_FAILED and a diff image past tolerance (percent of pixels); masks are left out. visual_baseline saves it. One element: check_element; pixels: take_screenshot. Returns the issues or the difference.',
    input: z
      .object({
        check: z.enum(['accessibility', 'visual', 'visual_baseline']),
        ...visual.input.omit({ action: true }).shape,
        name: visual.input.shape.name.optional(),
        ...audit.input.shape,
      })
      .strict(),
    // a baseline is a file on this Mac; the device stays as it was
    annotations: SAVES,
    parts: [audit, visual],
    pick: ({ check, ...a }) =>
      check === 'accessibility'
        ? [audit, a]
        : [visual, { ...a, action: check === 'visual' ? 'compare' : 'baseline' }],
  });

export const recordSession = ({ record, report }: Pick<Pieces, 'record' | 'report'>) =>
  mergeOp({
    name: 'record_session',
    title: 'Video and report',
    description:
      'Keep evidence. kind video: screen video, one per device; start, stop. report: a test report, index.html with steps, video, logs, crashes, measurements, secrets hidden; start, write, stop. timeline: start, the journey, stop: timeline.html, with video, touches, frames, requests, log and memory on one clock. flight: the last seconds, kept on a crash or stall. To replay actions: run_flow. Returns the file.',
    input: z
      .object({
        kind: z.enum(['video', 'report', 'timeline', 'flight']),
        action: z.enum(['start', 'stop', 'write']),
        ...record.input.omit({ action: true }).shape,
        ...report.input.omit({ action: true }).shape,
      })
      .strict(),
    annotations: DESTRUCTIVE,
    parts: [record, report],
    // a timeline and a flight recorder begin under their own word, and end and write as a report does
    pick: ({ kind, action, ...a }) =>
      kind === 'video'
        ? [record, { ...a, action }]
        : [report, { ...a, action: kind !== 'report' && action === 'start' ? kind : action }],
  });
