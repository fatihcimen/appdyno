// A Mac process that sends touches and keys into one booted simulator through its dtuhidd daemon, with no
// XCTest in between. Requests and answers are JSON lines on stdin and stdout; it ends with its stdin.
// The wire shape follows idb's DTUHID transport (MIT, see THIRD_PARTY_NOTICES). Private API: appdyno
// checks it at start and falls back to the runner's input.
#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <mach/mach.h>
#import <objc/runtime.h>
#import <os/lock.h>
#import <xpc/xpc.h>

static const char *const kService = "com.apple.coredevice.feature.remote.hid.digitizer";

@protocol Sim
+ (id)sharedServiceContextForDeveloperDir:(NSString *)dir error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
- (NSDictionary *)devicesByUDID;
- (mach_port_t)lookup:(NSString *)service error:(NSError **)error;
@end

static xpc_connection_t gConnection;

static void fail(NSString *why) {
  fprintf(stderr, "%s\n", why.UTF8String);
  exit(3);
}

static xpc_connection_t connectTo(NSString *udid) {
  dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW);
  Class contextClass = objc_getClass("SimServiceContext");
  if (!contextClass) fail(@"CoreSimulator is missing");
  NSString *dir = NSProcessInfo.processInfo.environment[@"DEVELOPER_DIR"];
  NSError *error = nil;
  id<Sim> context = [(id<Sim>)contextClass sharedServiceContextForDeveloperDir:dir error:&error];
  id<Sim> set = [context defaultDeviceSetWithError:&error];
  id<Sim> device = set.devicesByUDID[[[NSUUID alloc] initWithUUIDString:udid]];
  if (!device) fail(@"no such simulator");
  mach_port_t port = [device lookup:@(kService) error:&error];
  if (port == MACH_PORT_NULL) fail(error.localizedDescription ?: @"the service is not there");
  // the endpoint takes over the lookup's send right; without the sim2host mark the daemon sees the peer
  // but no payload
  xpc_object_t (*endpointOf)(mach_port_t, uint64_t, uint64_t) = dlsym(RTLD_DEFAULT, "xpc_endpoint_create_mach_port_4sim");
  xpc_connection_t (*fromEndpoint)(xpc_object_t) = dlsym(RTLD_DEFAULT, "xpc_connection_create_from_endpoint");
  void (*sim2host)(xpc_connection_t) = dlsym(RTLD_DEFAULT, "xpc_connection_enable_sim2host_4sim");
  if (!endpointOf || !fromEndpoint || !sim2host) fail(@"the XPC calls are missing");
  xpc_connection_t c = fromEndpoint(endpointOf(port, 0, 0));
  xpc_connection_set_event_handler(c, ^(xpc_object_t event) {
    if (event == XPC_ERROR_CONNECTION_INVALID) fail(@"the connection to dtuhidd ended");
  });
  sim2host(c);
  xpc_connection_resume(c);
  return c;
}

static xpc_object_t message(const char *type, xpc_object_t payload, bool barrier) {
  xpc_object_t m = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(m, "messageType", type);
  xpc_dictionary_set_bool(m, "isBarrier", barrier);
  xpc_dictionary_set_string(m, "featureIdentifier", kService);
  xpc_dictionary_set_value(m, "payload", payload);
  return m;
}

static xpc_object_t point(double x, double y) {
  xpc_object_t p = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_double(p, "x", x);
  xpc_dictionary_set_double(p, "y", y);
  return p;
}

// Usage 0 ("no event"): the daemon answers and the guest sees no key. A send to a dead daemon reports no
// error, so this answer is the only proof that one is there.
static BOOL barrier(int64_t timeoutMs) {
  xpc_object_t payload = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_uint64(payload, "usageCode", 0);
  xpc_dictionary_set_uint64(payload, "state", 2);
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block BOOL ok = NO;
  xpc_connection_send_message_with_reply(gConnection, message("IndigoKeyboardButtonEvent", payload, true),
                                         dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0),
                                         ^(xpc_object_t reply) {
                                           ok = xpc_get_type(reply) != XPC_TYPE_ERROR;
                                           dispatch_semaphore_signal(done);
                                         });
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, timeoutMs * NSEC_PER_MSEC))) return NO;
  return ok;
}

// What is down now, let go of when the helper ends, however it ends (its stdin closed, or a SIGTERM in the middle of a
// request): a daemon that kept a key or a finger down for a client gone would hold it for the next. Nothing is sent
// once that is done.
static os_unfair_lock gHeldLock = OS_UNFAIR_LOCK_INIT;
static NSMutableSet<NSArray<NSNumber *> *> *gHeldKeys; // [page, usage]
static NSDictionary *gFinger;                          // the last event of a touch not ended
static BOOL gEnded;

static void postTouch(NSDictionary *e, uint64_t phase) {
  xpc_object_t payload = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_value(payload, "pointOne", point([e[@"x"] doubleValue], [e[@"y"] doubleValue]));
  if (e[@"x2"]) xpc_dictionary_set_value(payload, "pointTwo", point([e[@"x2"] doubleValue], [e[@"y2"] doubleValue]));
  xpc_dictionary_set_uint64(payload, "eventType", phase);
  xpc_dictionary_set_uint64(payload, "edge", 0);
  xpc_dictionary_set_uint64(payload, "target", 0);
  xpc_connection_send_message(gConnection, message("IndigoDigitizerEvent", payload, false));
}

static void postKeyState(uint64_t page, uint64_t usage, uint64_t state) {
  xpc_object_t payload = xpc_dictionary_create(NULL, NULL, 0);
  if (page != 7) xpc_dictionary_set_uint64(payload, "usagePage", page);
  xpc_dictionary_set_uint64(payload, "usageCode", usage);
  xpc_dictionary_set_uint64(payload, "state", state);
  xpc_connection_send_message(gConnection, message(page == 7 ? "IndigoKeyboardButtonEvent" : "IndigoButtonEvent", payload, false));
}

// [{p: 0 start, 1 move, 2 end; x, y, x2?, y2? normalized; at: ms from the first}]
// `quick`: a person's finger in a live window, where the next move is the proof, not a round trip
static NSString *sendTouches(NSArray<NSDictionary *> *events, BOOL quick) {
  uint64_t start = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  for (NSDictionary *e in events) {
    uint64_t due = start + (uint64_t)([e[@"at"] doubleValue] * NSEC_PER_MSEC);
    uint64_t now = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
    if (due > now) usleep((useconds_t)((due - now) / 1000));
    uint64_t phase = [e[@"p"] unsignedLongLongValue];
    os_unfair_lock_lock(&gHeldLock);
    if (!gEnded) {
      postTouch(e, phase);
      gFinger = phase == 2 ? nil : e;
    }
    os_unfair_lock_unlock(&gHeldLock);
  }
  return quick || barrier(2000) ? nil : @"dtuhidd did not answer after the touches";
}

// A key of a keyboard (page 7) or a hardware button (another page) going down (1) or up (2).
static void sendKeyState(uint64_t page, uint64_t usage, uint64_t state) {
  os_unfair_lock_lock(&gHeldLock);
  if (!gEnded) {
    postKeyState(page, usage, state);
    NSArray<NSNumber *> *key = @[@(page), @(usage)];
    if (state == 1) [gHeldKeys addObject:key];
    else [gHeldKeys removeObject:key];
  }
  os_unfair_lock_unlock(&gHeldLock);
}

// Each key still down goes up, and a finger still down ends where it is, as a person's lifted would; once. A second
// caller (the end of stdin and a SIGTERM together) waits for the first, so that the process ends after the sends.
static void letGo(void) {
  os_unfair_lock_lock(&gHeldLock);
  if (!gEnded) {
    gEnded = YES;
    for (NSArray<NSNumber *> *key in gHeldKeys) postKeyState(key[0].unsignedLongLongValue, key[1].unsignedLongLongValue, 2);
    if (gFinger) postTouch(gFinger, 2);
    if (gHeldKeys.count || gFinger) {
      fprintf(stderr, "let go of %lu keys and %d fingers it held\n", (unsigned long)gHeldKeys.count, gFinger ? 1 : 0);
      // the sends go out in order: an answer after them is their delivery
      barrier(500);
    }
  }
  os_unfair_lock_unlock(&gHeldLock);
}

// One press, with the keyboard's `modifiers` held during it.
static NSString *sendKey(uint64_t page, uint64_t usage, NSArray<NSNumber *> *modifiers) {
  for (NSNumber *m in modifiers) sendKeyState(7, m.unsignedLongLongValue, 1);
  sendKeyState(page, usage, 1);
  usleep(40000);
  sendKeyState(page, usage, 2);
  for (NSNumber *m in modifiers.reverseObjectEnumerator) sendKeyState(7, m.unsignedLongLongValue, 2);
  return barrier(2000) ? nil : @"dtuhidd did not answer after the key";
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) fail(@"usage: SimHID <udid>");
    gConnection = connectTo(@(argv[1]));
    gHeldKeys = [NSMutableSet set];
    // the host ends a helper by closing its stdin and a SIGTERM at once, which may come inside a request
    signal(SIGTERM, SIG_IGN);
    static dispatch_source_t term;
    term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0));
    dispatch_source_set_event_handler(term, ^{
      letGo();
      exit(0);
    });
    dispatch_resume(term);
    char *line = NULL;
    size_t capacity = 0;
    while (getline(&line, &capacity, stdin) > 0) {
      @autoreleasepool {
        NSDictionary *q = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytesNoCopy:line length:strlen(line) freeWhenDone:NO] options:0 error:NULL];
        NSString *op = q[@"op"];
        NSString *error = nil;
        uint64_t t0 = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
        if ([op isEqual:@"ping"]) error = barrier([q[@"timeoutMs"] longLongValue] ?: 4000) ? nil : @"dtuhidd did not answer";
        else if ([op isEqual:@"touch"]) error = sendTouches(q[@"events"], [q[@"quick"] boolValue]);
        else if ([op isEqual:@"keyState"]) sendKeyState([q[@"page"] unsignedLongLongValue], [q[@"usage"] unsignedLongLongValue], [q[@"state"] unsignedLongLongValue]);
        else if ([op isEqual:@"key"]) error = sendKey([q[@"page"] unsignedLongLongValue], [q[@"usage"] unsignedLongLongValue], q[@"modifiers"]);
        else error = @"unknown request";
        NSMutableDictionary *a = [@{@"id": q[@"id"] ?: @0,
                                    @"ok": @(error == nil),
                                    @"ms": @((clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - t0) / 1000000)} mutableCopy];
        if (error) a[@"error"] = error;
        NSData *out = [NSJSONSerialization dataWithJSONObject:a options:0 error:NULL];
        fwrite(out.bytes, 1, out.length, stdout);
        fputc('\n', stdout);
        fflush(stdout);
      }
    }
    free(line);
    letGo();
  }
  return 0;
}
