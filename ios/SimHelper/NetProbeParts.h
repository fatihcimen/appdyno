// What NetProbe.m is made of, read into it alone: where it works, what it is told and its rules, the link it shapes,
// and what it keeps and measures of a request.
#import <Foundation/Foundation.h>
#include <fcntl.h>
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
/// A rule asks what a request's body holds: a body that comes by a stream is read before the rules are.
static BOOL rulesReadBody;
/// When the link is next free, down and up: requests in parallel share it.
static CFAbsoluteTime linkFree[2];
static int64_t bodiesKept;
static int detailCount;
static int requestCount;
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

static NSRegularExpression *pattern(id source, NSRegularExpressionOptions options) {
  return [source isKindOfClass:NSString.class] ? [NSRegularExpression regularExpressionWithPattern:source options:options error:nil] : nil;
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
    BOOL reads = NO;
    for (NSDictionary *rule in [read[@"rules"] isKindOfClass:NSArray.class] ? read[@"rules"] : @[]) {
      NSMutableDictionary *one = [rule mutableCopy];
      // a host is the same in any case, and a path is not
      one[@"hostPattern"] = pattern(rule[@"host"], NSRegularExpressionCaseInsensitive);
      one[@"pathPattern"] = pattern(rule[@"path"], 0);
      NSMutableArray *when = [NSMutableArray array];
      for (NSDictionary *header in rule[@"when"]) {
        NSRegularExpression *value = pattern(header[@"value"], 0);
        if (value && header[@"name"]) [when addObject:@[header[@"name"], value]];
      }
      one[@"whenPatterns"] = when;
      if ([rule[@"has"] count] && ![rule[@"off"] boolValue]) reads = YES;
      [compiled addObject:one];
    }
    rules = compiled;
    rulesReadBody = reads;
    return control;
  }
}

static BOOL whole(NSRegularExpression *re, NSString *text) {
  return [re firstMatchInString:text options:0 range:NSMakeRange(0, text.length)] != nil;
}

/// The value at a path of a JSON value as a rule's words name it: a text as it is, a number or a truth as JSON writes it.
static NSString *valueAt(id json, NSArray *path) {
  for (id key in path) {
    if ([key isKindOfClass:NSNumber.class]) json = [json isKindOfClass:NSArray.class] && [key unsignedIntegerValue] < [json count] ? json[[key unsignedIntegerValue]] : nil;
    else json = [json isKindOfClass:NSDictionary.class] ? json[key] : nil;
    if (!json) return nil;
  }
  if ([json isKindOfClass:NSString.class]) return json;
  if (json == (id)kCFBooleanTrue || json == (id)kCFBooleanFalse) return [json boolValue] ? @"true" : @"false";
  if ([json isKindOfClass:NSNumber.class]) return [json stringValue];
  if (json == NSNull.null) return @"null";
  NSData *written = [NSJSONSerialization dataWithJSONObject:json options:0 error:nil];
  return written ? [[NSString alloc] initWithData:written encoding:NSUTF8StringEncoding] : nil;
}

/// Whether a body holds all a rule asks of it: the value at a path where the body is JSON, else the words as written.
static BOOL bodyHolds(NSArray<NSDictionary *> *has, NSData *body) {
  if (!has.count) return YES;
  if (!body.length) return NO;
  id json = [NSJSONSerialization JSONObjectWithData:body options:NSJSONReadingFragmentsAllowed error:nil];
  NSString *text = [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding] ?: @"";
  for (NSDictionary *one in has) {
    NSArray *path = [one[@"path"] isKindOfClass:NSArray.class] ? one[@"path"] : nil;
    if (path && json) {
      if (![valueAt(json, path) isEqual:one[@"equals"]]) return NO;
    } else if (![one[@"text"] isKindOfClass:NSString.class] || [text rangeOfString:one[@"text"]].location == NSNotFound) return NO;
  }
  return YES;
}

/// The first rule that takes this request, with the body it sends, and one use of it counted.
static NSDictionary *ruleFor(NSURLRequest *request, NSData *body) {
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
      for (NSArray *header in rule[@"whenPatterns"]) {
        NSString *value = [request valueForHTTPHeaderField:header[0]];
        if (!value || !whole(header[1], value)) asked = NO;
      }
      if (!asked || !bodyHolds(rule[@"has"], body)) continue;
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

/// From one moment of a request to another in milliseconds, or -1 where either is not known.
static double span(NSDate *from, NSDate *to) {
  return from && to ? MAX(0, [to timeIntervalSinceDate:from] * 1000) : -1;
}

/// What the session measured of a request's last try: its phases, its protocol and address, whether the connection
/// was there already and whether the answer came from the cache, and the bytes of the body as they came.
static NSDictionary *timingsOf(NSURLSessionTaskTransactionMetrics *m) {
  if (!m) return nil;
  NSMutableDictionary *t = [@{
    @"dns": @(span(m.domainLookupStartDate, m.domainLookupEndDate)),
    @"connect": @(span(m.connectStartDate, m.connectEndDate)),
    @"tls": @(span(m.secureConnectionStartDate, m.secureConnectionEndDate)),
    @"wait": @(span(m.requestStartDate, m.responseStartDate)),
    @"receive": @(span(m.responseStartDate, m.responseEndDate)),
    @"reused": @(m.isReusedConnection),
    @"cache": @(m.resourceFetchType == NSURLSessionTaskMetricsResourceFetchTypeLocalCache),
    @"wire": @(m.countOfResponseBodyBytesReceived),
  } mutableCopy];
  if (m.networkProtocolName) t[@"proto"] = m.networkProtocolName;
  if (m.remoteAddress) t[@"ip"] = m.remoteAddress;
  return t;
}
