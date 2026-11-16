// NetProbe: injected into an app on a simulator (DYLD_INSERT_LIBRARIES), works in the folder APPDYNO_NET_DIR names.
// It writes a JSON line per finished request to log.jsonl there, after one for the process it is in, and reads
// control.json again whenever that file changes: whether to keep headers and bodies (bodies/<pid>-<n>.json), the
// rules that answer, fail, delay or send elsewhere a request, and how slow the network is. Once control.json is
// gone the probe does nothing more in this process. An NSURLProtocol sees what the URL loading system loads in the
// app's process: not background sessions (their requests run in another process), not WKWebView (nor that), not
// Network.framework (below it). A request has a line when it starts and one when it ends, by one number, so that
// one still under way shows. Its parts are in NetProbeParts.h.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>

#import "NetProbeParts.h"

@class AppdynoNetProtocol;

/// The one session the probe sends through, and whose task is whose request.
@interface AppdynoNetRouter : NSObject <NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, AppdynoNetProtocol *> *owners;
@end

static AppdynoNetRouter *router;

@interface AppdynoNetProtocol : NSURLProtocol
@property(nonatomic, strong) NSURLSessionDataTask *task;
@property(nonatomic, strong) NSDictionary *rule;
@property(nonatomic, copy) NSString *how;
@property(nonatomic, strong) NSData *sent;
@property(nonatomic, strong) NSHTTPURLResponse *answer;
@property(nonatomic, strong) NSMutableData *kept;
@property(nonatomic) BOOL keeps;
@property(nonatomic) double down;
@property(nonatomic) CFAbsoluteTime started;
@property(nonatomic) CFAbsoluteTime due;
@property(nonatomic) int64_t received;
/// Its number in this process, on its first line and its last; the size of what it sends; what the session measured.
@property(nonatomic) int number;
@property(nonatomic) int64_t sentSize;
@property(nonatomic, strong) NSDictionary *timings;
@property(atomic) BOOL stopped;
/// Its last line is written: once, whichever of its ends comes first.
@property(nonatomic) BOOL ended;
/// The loader's own thread and the modes its run loop was in: what it is told, it is told there.
@property(nonatomic, strong) NSThread *loader;
@property(nonatomic, copy) NSArray<NSRunLoopMode> *modes;
/// What the app is still to be told, each with the time it is due.
@property(nonatomic, strong) NSMutableArray<NSArray *> *waiting;
@end

@implementation AppdynoNetProtocol

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
  if (inert) return NO;
  NSString *scheme = request.URL.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return NO;
  return [NSURLProtocol propertyForKey:kHandled inRequest:request] == nil;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
  return request;
}

/// Runs `step` once what came before it has reached the app and `bytes` more have passed the link down.
- (void)pace:(NSUInteger)bytes then:(void (^)(void))step {
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  self.due = MAX(linkPassed(0, self.down, bytes), self.due);
  @synchronized(self) {
    [self.waiting addObject:@[@(self.due), [step copy]]];
  }
  void (^tell)(void) = ^{
    [self performSelector:@selector(tellDue) onThread:self.loader withObject:nil waitUntilDone:NO modes:self.modes];
  };
  if (self.due <= now) tell();
  else dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((self.due - now) * NSEC_PER_SEC)), paced, tell);
}

/// On the loader's own thread, each step whose time has come, in the order they were given: two timers of nearly
/// one moment fire in either order, and an end told before its body left the app with none.
- (void)tellDue {
  for (;;) {
    NSArray *next;
    @synchronized(self) {
      next = self.waiting.firstObject;
      if (!next || [next[0] doubleValue] > CFAbsoluteTimeGetCurrent()) return;
      [self.waiting removeObjectAtIndex:0];
    }
    if (!self.stopped) ((void (^)(void))next[1])();
  }
}

- (void)startLoading {
  self.started = CFAbsoluteTimeGetCurrent();
  self.loader = NSThread.currentThread;
  self.waiting = [NSMutableArray array];
  NSRunLoopMode mode = NSRunLoop.currentRunLoop.currentMode;
  self.modes = mode && ![mode isEqual:NSDefaultRunLoopMode] ? @[NSDefaultRunLoopMode, mode] : @[NSDefaultRunLoopMode];
  NSDictionary *now = controlNow();
  @synchronized(lock) {
    self.number = ++requestCount;
  }
  // said as it starts: one that hangs, or a stream that stays open, is in the log before it ends
  if (now) writeEntry(@{@"begin": @(self.number), @"at": @([[NSDate date] timeIntervalSince1970] * 1000), @"method": self.request.HTTPMethod ?: @"GET", @"url": self.request.URL.absoluteString ?: @""});
  NSDictionary *slow = [now[@"throttle"] isKindOfClass:NSDictionary.class] ? now[@"throttle"] : nil;
  self.keeps = [now[@"bodies"] boolValue];
  self.down = [slow[@"down"] doubleValue];
  NSMutableURLRequest *inner = [self.request mutableCopy];
  [NSURLProtocol setProperty:@YES forKey:kHandled inRequest:inner];
  NSUInteger length = (NSUInteger)MAX(0, [[inner valueForHTTPHeaderField:@"Content-Length"] integerValue]);
  // an upload by a stream is read, to be kept or for a rule that asks what it holds, only where it says it is no longer than what is kept: a longer one, or
  // one of no stated length, goes on as it came, untouched, and only its size is known
  if ((self.keeps || rulesReadBody) && inner.HTTPBodyStream && length > 0 && length <= kBodyCap) inner.HTTPBody = drained(inner.HTTPBodyStream);
  self.sent = inner.HTTPBody;
  self.rule = now ? ruleFor(self.request, self.sent) : nil;
  NSUInteger up = inner.HTTPBody.length ?: length;
  self.sentSize = (int64_t)up;
  NSArray<NSNumber *> *latency = slow[@"delayMs"];
  double wait = [self.rule[@"delayMs"] doubleValue] / 1000;
  if (latency.count == 2) wait += (latency[0].doubleValue + arc4random_uniform((uint32_t)(latency[1].doubleValue - latency[0].doubleValue) + 1)) / 1000;
  wait += linkPassed(1, [slow[@"up"] doubleValue], up) - CFAbsoluteTimeGetCurrent();
  BOOL lost = [slow[@"loss"] doubleValue] > 0 && arc4random_uniform(10000) < [slow[@"loss"] doubleValue] * 100;
  NSString *fail = lost ? @"reset" : self.rule[@"fail"];
  void (^go)(void) = ^{
    if (self.stopped) return;
    if (fail) {
      self.how = lost ? @"lost" : @"failed";
      NSInteger code = [fail isEqual:@"offline"] ? NSURLErrorNotConnectedToInternet : [fail isEqual:@"timeout"] ? NSURLErrorTimedOut
                                                                                                                : NSURLErrorNetworkConnectionLost;
      [self finish:[NSError errorWithDomain:NSURLErrorDomain code:code userInfo:@{NSURLErrorFailingURLErrorKey: self.request.URL}]];
    } else if (self.rule[@"status"]) [self answerByRule];
    else {
      NSDictionary *to = self.rule[@"to"];
      if (to) {
        NSURLComponents *parts = [NSURLComponents componentsWithURL:inner.URL resolvingAgainstBaseURL:NO];
        parts.host = to[@"host"];
        parts.port = to[@"port"];
        if (to[@"scheme"]) parts.scheme = to[@"scheme"];
        inner.URL = parts.URL;
        self.how = @"sent";
      } else if (self.rule) self.how = @"delayed";
      self.task = [router.session dataTaskWithRequest:inner];
      @synchronized(router) {
        router.owners[@(self.task.taskIdentifier)] = self;
      }
      [self.task resume];
    }
  };
  // never from inside this call, which the loader has not returned from
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(wait, 0) * NSEC_PER_SEC)), paced, go);
}

/// The rule's own answer: its status, headers and body, the body from its file as that reads now.
- (void)answerByRule {
  self.how = @"mocked";
  NSString *file = self.rule[@"bodyFile"];
  NSData *body = file ? [NSData dataWithContentsOfFile:file] : [self.rule[@"body"] dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableDictionary *headers = [self.rule[@"headers"] mutableCopy] ?: [NSMutableDictionary dictionary];
  headers[@"Content-Length"] = @(body.length).stringValue;
  NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:self.request.URL statusCode:[self.rule[@"status"] integerValue] HTTPVersion:@"HTTP/1.1" headerFields:headers];
  [self received:response];
  if (body.length) [self loaded:body];
  [self pace:0
        then:^{
          [self finish:file && !body ? [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorFileDoesNotExist userInfo:@{NSLocalizedDescriptionKey: [@"the rule's file is not there: " stringByAppendingString:file]}] : nil];
        }];
}

- (void)received:(NSURLResponse *)response {
  self.answer = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
  if (self.keeps && isText([self.answer valueForHTTPHeaderField:@"Content-Type"])) self.kept = [NSMutableData data];
  [self pace:0
        then:^{
          [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
        }];
}

- (void)loaded:(NSData *)data {
  self.received += data.length;
  if (self.kept.length < kBodyCap) [self.kept appendData:[data subdataWithRange:NSMakeRange(0, MIN(data.length, kBodyCap - self.kept.length))]];
  [self pace:data.length
        then:^{
          [self.client URLProtocol:self didLoadData:data];
        }];
}

/// The request's line in the log, its headers and bodies beside it where they are kept, and its end told to the app.
- (void)finish:(NSError *)error {
  @synchronized(self) {
    if (self.ended) return;
    self.ended = YES;
  }
  NSMutableDictionary *entry = [@{
    @"at": @([[NSDate date] timeIntervalSince1970] * 1000),
    @"method": self.request.HTTPMethod ?: @"GET",
    @"url": self.request.URL.absoluteString ?: @"",
    @"status": @(self.answer.statusCode),
    @"ms": @((CFAbsoluteTimeGetCurrent() - self.started) * 1000),
    @"bytes": @(self.received),
    @"n": @(self.number),
  } mutableCopy];
  if (self.timings) entry[@"timings"] = self.timings;
  if (error) {
    entry[@"error"] = error.localizedDescription;
    entry[@"code"] = @(error.code);
  }
  if (self.how) entry[@"how"] = self.how;
  if (self.rule[@"id"]) entry[@"rule"] = self.rule[@"id"];
  if ([self.how isEqual:@"sent"]) entry[@"to"] = self.task.originalRequest.URL.host ?: @"";
  if (self.keeps && logFd >= 0) {
    NSMutableDictionary *detail = [NSMutableDictionary dictionary];
    detail[@"requestHeaders"] = self.request.allHTTPHeaderFields ?: @{};
    detail[@"responseHeaders"] = self.answer.allHeaderFields ?: @{};
    keepBody(detail, @"request", self.sent.length > kBodyCap ? [self.sent subdataWithRange:NSMakeRange(0, kBodyCap)] : self.sent, self.sentSize, [self.request valueForHTTPHeaderField:@"Content-Type"]);
    keepBody(detail, @"response", self.kept, self.received, [self.answer valueForHTTPHeaderField:@"Content-Type"]);
    NSString *name;
    @synchronized(lock) {
      name = [NSString stringWithFormat:@"%d-%d", getpid(), ++detailCount];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:detail options:0 error:nil];
    NSString *file = [NSString stringWithFormat:@"%@/bodies/%@.json", folder, name];
    int fd = json ? open(file.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL, 0600) : -1;
    if (fd >= 0) {
      write(fd, json.bytes, json.length);
      close(fd);
      entry[@"detail"] = name;
    }
  }
  writeEntry(entry);
  // one the app gave up is in the log, and the app hears no more of it
  if (self.stopped) return;
  if (error) [self.client URLProtocol:self didFailWithError:error];
  else [self.client URLProtocolDidFinishLoading:self];
}

- (void)stopLoading {
  self.stopped = YES;
  if (self.task) [self.task cancel];
  // given up while it waited for a rule or the throttle, or while a rule's answer was on its way: no task ends it, and
  // without its last line it would stand as in flight for as long as the app runs
  else [self finish:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]];
}

@end

@implementation AppdynoNetRouter

- (AppdynoNetProtocol *)ownerOf:(NSURLSessionTask *)task {
  @synchronized(self) {
    return self.owners[@(task.taskIdentifier)];
  }
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
  [[self ownerOf:task] received:response];
  completion(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
  [[self ownerOf:task] loaded:data];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion {
  AppdynoNetProtocol *owner = [self ownerOf:task];
  NSMutableURLRequest *next = [request mutableCopy];
  [NSURLProtocol removePropertyForKey:kHandled inRequest:next];
  [owner.client URLProtocol:owner wasRedirectedToRequest:next redirectResponse:response];
  completion(nil);
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didFinishCollectingMetrics:(NSURLSessionTaskMetrics *)metrics {
  [self ownerOf:task].timings = timingsOf(metrics.transactionMetrics.lastObject);
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  AppdynoNetProtocol *owner = [self ownerOf:task];
  @synchronized(self) {
    [self.owners removeObjectForKey:@(task.taskIdentifier)];
  }
  // one the app gave up is told nothing, and is in the log all the same
  if (owner.stopped) [owner finish:error];
  else
    [owner pace:0
           then:^{
             [owner finish:error];
           }];
}

@end

/// A session made from a configuration has its own list of protocols: ours goes first in each.
static void addToConfiguration(SEL selector) {
  Method m = class_getClassMethod(NSURLSessionConfiguration.class, selector);
  if (!m) return;
  typedef NSURLSessionConfiguration *(*Getter)(id, SEL);
  Getter original = (Getter)method_getImplementation(m);
  id replacement = ^NSURLSessionConfiguration *(id self) {
    NSURLSessionConfiguration *config = original(self, selector);
    NSMutableArray *classes = [config.protocolClasses mutableCopy] ?: [NSMutableArray array];
    if (![classes containsObject:AppdynoNetProtocol.class]) [classes insertObject:AppdynoNetProtocol.class atIndex:0];
    config.protocolClasses = classes;
    return config;
  };
  method_setImplementation(m, imp_implementationWithBlock(replacement));
}

__attribute__((constructor)) static void start(void) {
  const char *path = getenv("APPDYNO_NET_DIR");
  if (!path) return;
  folder = @(path);
  lock = [NSObject new];
  ruleUses = [NSMutableDictionary dictionary];
  paced = dispatch_queue_create("dev.appdyno.netprobe", DISPATCH_QUEUE_SERIAL);
  logFd = open([folder stringByAppendingPathComponent:@"log.jsonl"].fileSystemRepresentation, O_WRONLY | O_CREAT | O_APPEND, 0600);
  // the process the lines after it come from: one started elsewhere has no probe in it
  writeEntry(@{
    @"loaded": NSBundle.mainBundle.bundleIdentifier ?: @"?",
    @"pid": @(getpid()),
    @"t": @([[NSDate date] timeIntervalSince1970] * 1000),
  });
  // one session for all of them keeps its connections, and the app's own cookies, cache and credentials; taken
  // before the configurations get the probe, so that what it sends does not come back to it
  NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
  config.protocolClasses = @[];
  router = [AppdynoNetRouter new];
  router.owners = [NSMutableDictionary dictionary];
  router.session = [NSURLSession sessionWithConfiguration:config delegate:router delegateQueue:nil];
  [NSURLProtocol registerClass:AppdynoNetProtocol.class];
  addToConfiguration(@selector(defaultSessionConfiguration));
  addToConfiguration(@selector(ephemeralSessionConfiguration));
}
