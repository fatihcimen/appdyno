// NetProbe: injected into an app on a simulator (DYLD_INSERT_LIBRARIES), works in the folder APPDYNO_NET_DIR names.
// It writes a JSON line per finished request to log.jsonl there, after one for the process it is in, and reads
// control.json again whenever that file changes: whether to keep headers and bodies (bodies/<pid>-<n>.json), the
// rules that answer, fail, delay or send elsewhere a request, and how slow the network is. Once control.json is
// gone the probe does nothing more in this process. An NSURLProtocol sees what the URL loading system loads in the
// app's process: not background sessions (their requests run in another process), not WKWebView (nor that), not
// Network.framework (below it).
#import <Foundation/Foundation.h>
#include <fcntl.h>
#import <objc/runtime.h>
#include <sys/stat.h>
#include <unistd.h>

static NSString *const kHandled = @"dev.appdyno.netprobe.handled";
/// A text body is kept to here, and all the bodies of a capture to there.
static const NSUInteger kBodyCap = 64 * 1024;
static const int64_t kCaptureCap = 20 * 1024 * 1024;

static NSString *folder;
static int logFd = -1;
static BOOL inert;
static NSObject *lock;
static struct timespec controlChanged;
static NSDictionary *control;
static NSArray<NSDictionary *> *rules;
static NSMutableDictionary<NSString *, NSNumber *> *ruleUses;
/// When the link is next free, down and up: requests in parallel share it.
static CFAbsoluteTime linkFree[2];
static int64_t bodiesKept;
static int detailCount;
static dispatch_queue_t paced;

static void writeEntry(NSDictionary *entry) {
  if (logFd < 0) return;
  NSData *json = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
  if (!json) return;
  NSMutableData *line = [json mutableCopy];
  [line appendBytes:"\n" length:1];
  // one write of an O_APPEND file: lines of concurrent requests do not mix
  write(logFd, line.bytes, line.length);
}

static NSRegularExpression *pattern(id source) {
  return [source isKindOfClass:NSString.class] ? [NSRegularExpression regularExpressionWithPattern:source options:NSRegularExpressionCaseInsensitive error:nil] : nil;
}

/// What control.json says now, read again when it has changed; nil once it is gone, and from then on.
static NSDictionary *controlNow(void) {
  @synchronized(lock) {
    if (inert) return nil;
    struct stat s;
    if (stat([folder stringByAppendingPathComponent:@"control.json"].fileSystemRepresentation, &s) != 0) {
      inert = YES;
      close(logFd);
      logFd = -1;
      control = nil;
      rules = nil;
      return nil;
    }
    if (control && s.st_mtimespec.tv_sec == controlChanged.tv_sec && s.st_mtimespec.tv_nsec == controlChanged.tv_nsec) return control;
    NSData *data = [NSData dataWithContentsOfFile:[folder stringByAppendingPathComponent:@"control.json"]];
    NSDictionary *read = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    // half written: what held before holds until it reads whole
    if (![read isKindOfClass:NSDictionary.class]) return control ?: @{};
    controlChanged = s.st_mtimespec;
    control = read;
    NSMutableArray *compiled = [NSMutableArray array];
    for (NSDictionary *rule in [read[@"rules"] isKindOfClass:NSArray.class] ? read[@"rules"] : @[]) {
      NSMutableDictionary *one = [rule mutableCopy];
      one[@"hostPattern"] = pattern(rule[@"host"]);
      one[@"pathPattern"] = pattern(rule[@"path"]);
      [compiled addObject:one];
    }
    rules = compiled;
    return control;
  }
}

static BOOL whole(NSRegularExpression *re, NSString *text) {
  return [re firstMatchInString:text options:0 range:NSMakeRange(0, text.length)] != nil;
}

/// The first rule that takes this request, and one use of it counted.
static NSDictionary *ruleFor(NSURLRequest *request) {
  NSURL *url = request.URL;
  NSString *host = url.host.lowercaseString ?: @"";
  NSString *withPort = url.port ? [NSString stringWithFormat:@"%@:%@", host, url.port] : host;
  NSString *path = url.path.length ? url.path : @"/";
  NSArray<NSURLQueryItem *> *query = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO].queryItems ?: @[];
  @synchronized(lock) {
    for (NSDictionary *rule in rules) {
      if ([rule[@"off"] boolValue]) continue;
      NSString *method = rule[@"method"];
      if (method && [method caseInsensitiveCompare:request.HTTPMethod ?: @"GET"] != NSOrderedSame) continue;
      NSRegularExpression *hosts = rule[@"hostPattern"], *paths = rule[@"pathPattern"];
      if (hosts && !whole(hosts, host) && !whole(hosts, withPort)) continue;
      if (paths && !whole(paths, path)) continue;
      BOOL asked = YES;
      for (NSArray<NSString *> *pair in rule[@"query"]) {
        NSUInteger at = [query indexOfObjectPassingTest:^BOOL(NSURLQueryItem *item, __unused NSUInteger i, __unused BOOL *stop) {
          return [item.name isEqual:pair[0]] && [item.value ?: @"" isEqual:pair[1]];
        }];
        if (at == NSNotFound) asked = NO;
      }
      if (!asked) continue;
      NSString *ruleId = rule[@"id"] ?: @"";
      NSInteger used = ruleUses[ruleId].integerValue;
      if (rule[@"times"] && used >= [rule[@"times"] integerValue]) continue;
      ruleUses[ruleId] = @(used + 1);
      return rule;
    }
  }
  return nil;
}

/// When `bytes` more have passed a link of `rate` bytes a second, 0 down and 1 up; now where it has no limit.
static CFAbsoluteTime linkPassed(int way, double rate, NSUInteger bytes) {
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (rate <= 0 || bytes == 0) return now;
  @synchronized(lock) {
    linkFree[way] = MAX(now, linkFree[way]) + bytes / rate;
    return linkFree[way];
  }
}

static BOOL isText(NSString *type) {
  return type && [type rangeOfString:@"^text/|json|xml|javascript|x-www-form-urlencoded|graphql" options:NSRegularExpressionSearch | NSCaseInsensitiveSearch].location != NSNotFound;
}

/// A body as the detail keeps it: its text to the cap where its type is one, and its size and type always.
static void keepBody(NSMutableDictionary *detail, NSString *key, NSData *body, int64_t size, NSString *type) {
  detail[[key stringByAppendingString:@"BodySize"]] = @(size);
  if (!body.length || !isText(type)) return;
  @synchronized(lock) {
    if (bodiesKept + (int64_t)body.length > kCaptureCap) {
      detail[@"note"] = @"over the capture's 20 MB of bodies: not kept";
      return;
    }
    bodiesKept += body.length;
  }
  NSString *text = nil;
  // a cut may fall inside a character: it ends at the one before
  for (NSUInteger cut = 0; !text && cut < 4 && cut < body.length; cut++) text = [[NSString alloc] initWithData:[body subdataWithRange:NSMakeRange(0, body.length - cut)] encoding:NSUTF8StringEncoding];
  detail[[key stringByAppendingString:@"Body"]] = text ?: [[NSString alloc] initWithData:body encoding:NSISOLatin1StringEncoding];
}

static NSData *drained(NSInputStream *stream) {
  NSMutableData *all = [NSMutableData data];
  uint8_t part[16384];
  [stream open];
  for (NSInteger n; (n = [stream read:part maxLength:sizeof part]) > 0;) [all appendBytes:part length:(NSUInteger)n];
  [stream close];
  return all;
}

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
@property(atomic) BOOL stopped;
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
  CFAbsoluteTime at = MAX(linkPassed(0, self.down, bytes), self.due);
  if (at <= now) {
    if (!self.stopped) step();
    return;
  }
  // a little later than the last, so that two of one moment keep their order
  self.due = at + 1e-6;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((self.due - now) * NSEC_PER_SEC)), paced, ^{
    if (!self.stopped) step();
  });
}

- (void)startLoading {
  self.started = CFAbsoluteTimeGetCurrent();
  NSDictionary *now = controlNow();
  NSDictionary *slow = [now[@"throttle"] isKindOfClass:NSDictionary.class] ? now[@"throttle"] : nil;
  self.rule = now ? ruleFor(self.request) : nil;
  self.keeps = [now[@"bodies"] boolValue];
  self.down = [slow[@"down"] doubleValue];
  NSMutableURLRequest *inner = [self.request mutableCopy];
  [NSURLProtocol setProperty:@YES forKey:kHandled inRequest:inner];
  // shortcut: with bodies kept an upload is read whole into memory, and one the app still writes is waited for; tee the stream if uploads grow
  if (self.keeps && inner.HTTPBodyStream) inner.HTTPBody = drained(inner.HTTPBodyStream);
  self.sent = inner.HTTPBody;
  NSUInteger up = inner.HTTPBody.length ?: (NSUInteger)[[inner valueForHTTPHeaderField:@"Content-Length"] integerValue];
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
  // never from inside this call: an answer with no body, told whole before it returns, reached the app as no response
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
  NSMutableDictionary *entry = [@{
    @"at": @([[NSDate date] timeIntervalSince1970] * 1000),
    @"method": self.request.HTTPMethod ?: @"GET",
    @"url": self.request.URL.absoluteString ?: @"",
    @"status": @(self.answer.statusCode),
    @"ms": @((CFAbsoluteTimeGetCurrent() - self.started) * 1000),
    @"bytes": @(self.received),
  } mutableCopy];
  if (error) entry[@"error"] = error.localizedDescription;
  if (self.how) entry[@"how"] = self.how;
  if (self.rule[@"id"]) entry[@"rule"] = self.rule[@"id"];
  if ([self.how isEqual:@"sent"]) entry[@"to"] = self.task.originalRequest.URL.host ?: @"";
  if (self.keeps && logFd >= 0) {
    NSMutableDictionary *detail = [NSMutableDictionary dictionary];
    detail[@"requestHeaders"] = self.request.allHTTPHeaderFields ?: @{};
    detail[@"responseHeaders"] = self.answer.allHeaderFields ?: @{};
    keepBody(detail, @"request", self.sent.length > kBodyCap ? [self.sent subdataWithRange:NSMakeRange(0, kBodyCap)] : self.sent, (int64_t)self.sent.length, [self.request valueForHTTPHeaderField:@"Content-Type"]);
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
  [self.task cancel];
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

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  AppdynoNetProtocol *owner = [self ownerOf:task];
  @synchronized(self) {
    [self.owners removeObjectForKey:@(task.taskIdentifier)];
  }
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
