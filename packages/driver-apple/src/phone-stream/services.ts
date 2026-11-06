import { randomUUID } from 'node:crypto';
import { type IpStack } from './ipstack.js';
import { RemoteXpc } from './remotexpc.js';
import { XpcInt64, XpcUuid, type Decoded, type DecodedDict, type XpcValue } from './xpc-codec.js';

/** The phone's service list, and the request shape every CoreDevice service takes. */

const CORE_DEVICE_VERSION = {
  originalComponentsCount: new XpcInt64(2),
  components: [651n, 28n],
  stringValue: '651.28',
};

export type ServiceList = {
  ports: Record<string, number>;
  properties: DecodedDict;
  /** Service ports are numbered per discovery connection, and good while it lasts. */
  close(): void;
};

export const DISPLAY = 'com.apple.coredevice.displayservice';
export const SCREEN_CAPTURE = 'com.apple.coredevice.screencaptureservice';
export const HID_INDIGO = 'com.apple.coredevice.hid.indigo';
export const HID_UNIVERSAL = 'com.apple.coredevice.hid.universalhidservice';

/** On our own tunnel's discovery port, which has no other client. */
export async function readServices(stack: IpStack, rsdPort: number): Promise<ServiceList> {
  const x = RemoteXpc.start(await stack.connect(rsdPort));
  x.send(
    {
      MessageType: 'Handshake',
      MessagingProtocolVersion: 7n,
      UUID: new XpcUuid(randomUUID()),
      Properties: { RemoteXPCVersionFlags: 0x0100000000000006n, SensitivePropertiesVisible: true },
      Services: {},
    },
    false,
  );
  for (;;) {
    const m = await x.next();
    const services = m.Services as Record<string, { Port?: Decoded }> | undefined;
    if (!services) continue;
    const ports: Record<string, number> = {};
    for (const [name, s] of Object.entries(services)) {
      const port = Number(s.Port);
      if (port) ports[name] = port;
    }
    return {
      ports,
      properties: (m.Properties ?? {}) as DecodedDict,
      close: () => x.close(),
    };
  }
}

/** The screen as the phone's own service has it, with no stream. */
export async function takeScreenshot(
  stack: IpStack,
  services: ServiceList,
  format: 'png' | 'jpeg',
): Promise<Buffer> {
  const port = services.ports[SCREEN_CAPTURE];
  if (!port) throw new Error('the phone lists no screenshot service');
  const service = RemoteXpc.start(await stack.connect(port));
  try {
    const answer = await invoke(
      service,
      'com.apple.coredevice.feature.capturescreenshot',
      { requestedFormat: format },
      'com.apple.coredevice.action.capturescreenshot',
    );
    if (!Buffer.isBuffer(answer.image)) throw new Error('the screenshot came without its image');
    return answer.image;
  } finally {
    service.close();
  }
}

/** The readable words of what a service refused with, wherever in its answer they are. */
export function errorWords(error: Decoded | undefined): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object' || Buffer.isBuffer(error)) return '';
  const out: string[] = [];
  for (const [k, v] of Object.entries(error)) {
    if (typeof v === 'string' && /description|reason|message|NSLocalized/i.test(k)) out.push(v);
    else if (v && typeof v === 'object') out.push(errorWords(v));
  }
  return out.filter(Boolean).join('; ');
}

/** One feature's request and its answer. Its refusal throws, with the service's words. */
export async function invoke(
  x: RemoteXpc,
  feature: string,
  input: XpcValue,
  action?: string,
  timeoutMs = 15_000,
): Promise<DecodedDict> {
  x.send(
    {
      'CoreDevice.CoreDeviceDDIProtocolVersion': new XpcInt64(action ? 2 : 0),
      'CoreDevice.action': {},
      'CoreDevice.coreDeviceVersion': CORE_DEVICE_VERSION,
      'CoreDevice.deviceIdentifier': randomUUID(),
      'CoreDevice.featureIdentifier': feature,
      'CoreDevice.input': input,
      'CoreDevice.invocationIdentifier': randomUUID(),
      ...(action ? { 'CoreDevice.actionIdentifier': action } : {}),
    },
    true,
  );
  const reply = await x.next(timeoutMs);
  const output = reply['CoreDevice.output'];
  if (output === undefined) {
    throw new Error(errorWords(reply['CoreDevice.error']) || `${feature} was refused`);
  }
  return output as DecodedDict;
}
