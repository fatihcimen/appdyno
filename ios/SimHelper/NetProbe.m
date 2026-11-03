// NetProbe: injected into an app on a simulator (DYLD_INSERT_LIBRARIES), writes a JSON line per finished
// request to the file APPDYNO_NET_LOG names. An NSURLProtocol sees what the URL loading system loads in the
// app's process: not background sessions (their requests run in another process), not WKWebView (nor
// that), not Network.framework (below it). Bodies are not kept.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <fcntl.h>
#include <unistd.h>

static NSString *const kHandled = @"dev.appdyno.netprobe.handled";
static int logFd = -1;

static void writeEntry(NSDictionary *entry) {
  if (logFd < 0) return;
  NSData *json = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
  if (!json) return;
  NSMutableData *line = [json mutableCopy];
  [line appendBytes:"\n" length:1];
  // one write of an O_APPEND file: lines of concurrent requests do not mix
  write(logFd, line.bytes, line.length);
}

@interface AppdynoProbe : NSURLProtocol <NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSURLSessionDataTask *task;
@property(nonatomic) CFAbsoluteTime started;
@property(nonatomic) NSInteger status;
@property(nonatomic) int64_t received;
@end

@implementation AppdynoProbe

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
  NSString *scheme = request.URL.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return NO;
  return [NSURLProtocol propertyForKey:kHandled inRequest:request] == nil;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
  return request;
}

- (void)startLoading {
  self.started = CFAbsoluteTimeGetCurrent();
  NSMutableURLRequest *inner = [self.request mutableCopy];
  [NSURLProtocol setProperty:@YES forKey:kHandled inRequest:inner];
  NSURLSessionConfiguration *config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  config.protocolClasses = @[];
  self.session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
  self.task = [self.session dataTaskWithRequest:inner];
  [self.task resume];
}

- (void)stopLoading {
  [self.task cancel];
  [self.session finishTasksAndInvalidate];
}

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)task
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
  self.status = [response isKindOfClass:NSHTTPURLResponse.class]
                    ? ((NSHTTPURLResponse *)response).statusCode
                    : 0;
  [self.client URLProtocol:self
        didReceiveResponse:response
        cacheStoragePolicy:NSURLCacheStorageNotAllowed];
  completion(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)task
    didReceiveData:(NSData *)data {
  self.received += data.length;
  [self.client URLProtocol:self didLoadData:data];
}

- (void)URLSession:(NSURLSession *)session
                          task:(NSURLSessionTask *)task
    willPerformHTTPRedirection:(NSHTTPURLResponse *)response
                    newRequest:(NSURLRequest *)request
             completionHandler:(void (^)(NSURLRequest *))completion {
  NSMutableURLRequest *next = [request mutableCopy];
  [NSURLProtocol removePropertyForKey:kHandled inRequest:next];
  [self.client URLProtocol:self wasRedirectedToRequest:next redirectResponse:response];
  completion(nil);
}

- (void)URLSession:(NSURLSession *)session
                    task:(NSURLSessionTask *)task
    didCompleteWithError:(NSError *)error {
  NSMutableDictionary *entry = [@{
    @"at" : @([[NSDate date] timeIntervalSince1970] * 1000),
    @"method" : self.request.HTTPMethod ?: @"GET",
    @"url" : self.request.URL.absoluteString ?: @"",
    @"status" : @(self.status),
    @"ms" : @((CFAbsoluteTimeGetCurrent() - self.started) * 1000),
    @"bytes" : @(self.received),
  } mutableCopy];
  if (error) entry[@"error"] = error.localizedDescription;
  writeEntry(entry);
  if (error) [self.client URLProtocol:self didFailWithError:error];
  else [self.client URLProtocolDidFinishLoading:self];
  [session finishTasksAndInvalidate];
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
    if (![classes containsObject:AppdynoProbe.class]) [classes insertObject:AppdynoProbe.class atIndex:0];
    config.protocolClasses = classes;
    return config;
  };
  method_setImplementation(m, imp_implementationWithBlock(replacement));
}

__attribute__((constructor)) static void start(void) {
  const char *path = getenv("APPDYNO_NET_LOG");
  if (!path) return;
  logFd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0600);
  [NSURLProtocol registerClass:AppdynoProbe.class];
  addToConfiguration(@selector(defaultSessionConfiguration));
  addToConfiguration(@selector(ephemeralSessionConfiguration));
}
