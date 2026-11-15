// The view probe: injected into a simulator app when it is launched (no change to the app). It listens on the Unix
// socket APPDYNO_VIEW_SOCKET names, and to "dump" answers one JSON object: the views of the app's scenes on the screen,
// window by window from the back, each after its parent, read on the main thread. A secure field's text, and the text of
// all in it, is never read.
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <dlfcn.h>
#import <objc/runtime.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/time.h>
#import <sys/un.h>
#import <unistd.h>

/** More views than a screen shows: a walk that reaches it stops there, and says so. */
enum { MAX_VIEWS = 5000 };
/** How long the main thread may leave a walk waiting before the answer says it did not answer. */
static const int64_t MAIN_WAIT_MS = 2000;
/** How long a client may take to ask, and to take the answer. */
static const struct timeval CLIENT_WAIT = {.tv_sec = 5};

typedef char *(*Demangler)(const char *, size_t, char *, size_t *, uint32_t);

static double nowMs(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0;
}

static NSNumber *tenths(CGFloat v) { return @(round(v * 10) / 10); }

/** The text a view shows of its own: a label's, a field's, a button's title. */
static NSString *textOf(UIView *v) {
  if ([v isKindOfClass:UILabel.class]) return ((UILabel *)v).text;
  if ([v isKindOfClass:UITextField.class]) return ((UITextField *)v).text;
  if ([v isKindOfClass:UITextView.class]) return ((UITextView *)v).text;
  if ([v isKindOfClass:UIButton.class]) return ((UIButton *)v).currentTitle;
  return nil;
}

/** A field whose characters are a secret: what it holds, its own views' text among it, is never read. */
static BOOL secure(UIView *v) {
  if (![v conformsToProtocol:@protocol(UITextInputTraits)] ||
      ![v respondsToSelector:@selector(isSecureTextEntry)])
    return NO;
  return ((id<UITextInputTraits>)v).isSecureTextEntry;
}

/** One walk of the app's views, on the main thread. */
@interface AppdynoViewProbe : NSObject
@property(nonatomic, readonly) NSMutableArray<NSDictionary *> *views;
@property(nonatomic) BOOL truncated;
@end

@implementation AppdynoViewProbe {
  NSMutableDictionary<NSValue *, NSString *> *names;
  /** Each controller's view, to the controller's name. */
  NSMapTable<UIView *, NSString *> *owners;
  Demangler demangle;
}

- (instancetype)init {
  if ((self = [super init])) {
    _views = [NSMutableArray array];
    names = [NSMutableDictionary dictionary];
    owners = [NSMapTable strongToStrongObjectsMapTable];
    // Swift's runtime, where the app has it: an app of Objective-C alone has no mangled names
    demangle = (Demangler)dlsym(RTLD_DEFAULT, "swift_demangle");
  }
  return self;
}

/** A class as its module and name say it; a Swift name the runtime does not demangle stays as it is. */
- (NSString *)nameOf:(Class)cls {
  NSValue *key = [NSValue valueWithPointer:(__bridge const void *)cls];
  NSString *known = names[key];
  if (known) return known;
  const char *raw = class_getName(cls);
  NSString *name = @(raw);
  BOOL mangled = strncmp(raw, "_Tt", 3) == 0 || strncmp(raw, "$s", 2) == 0;
  char *plain = demangle && mangled ? demangle(raw, strlen(raw), NULL, NULL, 0) : NULL;
  if (plain) {
    name = [NSString stringWithUTF8String:plain] ?: name;
    free(plain);
  }
  names[key] = name;
  return name;
}

- (void)walk:(UIView *)view
      parent:(NSInteger)parent
          in:(id<UICoordinateSpace>)screen
      secret:(BOOL)inSecret {
  if (self.views.count >= MAX_VIEWS) {
    self.truncated = YES;
    return;
  }
  BOOL secret = inSecret || secure(view);
  CGRect r = [view convertRect:view.bounds toCoordinateSpace:screen];
  NSMutableDictionary *v = [@{
    @"class": [self nameOf:view.class],
    @"rect": @{@"x": tenths(r.origin.x), @"y": tenths(r.origin.y), @"width": tenths(r.size.width), @"height": tenths(r.size.height)},
  } mutableCopy];
  if (parent >= 0) v[@"parent"] = @(parent);
  if (view.accessibilityIdentifier.length > 0) v[@"id"] = view.accessibilityIdentifier;
  // a secure field's own label names it ("Password"); what is in it may echo what was typed
  NSString *label = inSecret ? nil : view.accessibilityLabel;
  if (label.length > 0) v[@"label"] = label;
  NSString *text = secret ? nil : textOf(view);
  if (text.length > 0) v[@"text"] = text;
  if (view.hidden) v[@"hidden"] = @YES;
  if (view.alpha < 1) v[@"alpha"] = @(round(view.alpha * 100) / 100);
  NSString *owner = [owners objectForKey:view];
  if (owner) v[@"controller"] = owner;
  NSInteger index = (NSInteger)self.views.count;
  [self.views addObject:v];
  // nothing in a view that is not drawn is drawn either
  if (view.hidden || view.alpha <= 0) return;
  for (UIView *sub in view.subviews) [self walk:sub parent:index in:screen secret:secret];
}

/**
 * The controllers from a window's root, the ones each holds and presents: a hosting view answers to SwiftUI's responder
 * chain, which does not lead to the controller whose view it is.
 */
- (void)noteControllers:(UIViewController *)vc seen:(NSHashTable *)seen {
  if (!vc || [seen containsObject:vc]) return;
  [seen addObject:vc];
  if (vc.isViewLoaded) [owners setObject:[self nameOf:vc.class] forKey:vc.view];
  for (UIViewController *child in vc.childViewControllers) [self noteControllers:child seen:seen];
  [self noteControllers:vc.presentedViewController seen:seen];
}

/** The windows of the app's scenes on the screen, from the back; whether it has any there. */
- (BOOL)walkApp {
  NSMutableArray<UIWindow *> *windows = [NSMutableArray array];
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    if (scene.activationState == UISceneActivationStateBackground ||
        scene.activationState == UISceneActivationStateUnattached)
      continue;
    [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
  }
  [windows sortWithOptions:NSSortStable
           usingComparator:^NSComparisonResult(UIWindow *a, UIWindow *b) {
             if (a.windowLevel == b.windowLevel) return NSOrderedSame;
             return a.windowLevel < b.windowLevel ? NSOrderedAscending : NSOrderedDescending;
           }];
  NSHashTable *seen = [NSHashTable hashTableWithOptions:NSPointerFunctionsObjectPointerPersonality];
  for (UIWindow *w in windows) [self noteControllers:w.rootViewController seen:seen];
  for (UIWindow *w in windows)
    [self walk:w parent:-1 in:w.windowScene.screen.coordinateSpace secret:NO];
  return windows.count > 0;
}

@end

/**
 * The app's views, walked on the main thread; an error where the main thread did not take the walk up within 2 s. A walk
 * it takes up late is never begun: the answer has gone without it.
 */
static NSDictionary *dump(void) {
  dispatch_semaphore_t claim = dispatch_semaphore_create(0), done = dispatch_semaphore_create(0);
  // made at 0 and raised: one made at 1 may not be freed below it
  dispatch_semaphore_signal(claim);
  __block NSDictionary *answer = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (dispatch_semaphore_wait(claim, DISPATCH_TIME_NOW) != 0) return;
    double started = nowMs();
    AppdynoViewProbe *probe = [AppdynoViewProbe new];
    BOOL front = [probe walkApp];
    answer = @{
      @"app": NSBundle.mainBundle.bundleIdentifier ?: @"?",
      @"pid": @(getpid()),
      @"front": @(front),
      @"views": probe.views,
      @"truncated": @(probe.truncated),
      @"ms": tenths(nowMs() - started),
    };
    dispatch_semaphore_signal(done);
  });
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, MAIN_WAIT_MS * NSEC_PER_MSEC)) != 0) {
    if (dispatch_semaphore_wait(claim, DISPATCH_TIME_NOW) == 0)
      return @{
        @"error": @"main-thread",
        @"ms": @(MAIN_WAIT_MS),
      };
    // the walk began in time: its end
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  }
  return answer;
}

/** One request and its answer: a client gone early is no signal to the app. */
static void serve(int client) {
  int on = 1;
  setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
  setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &CLIENT_WAIT, sizeof CLIENT_WAIT);
  setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &CLIENT_WAIT, sizeof CLIENT_WAIT);
  char request[16] = {0};
  ssize_t n = read(client, request, sizeof request - 1);
  NSDictionary *reply = n >= 4 && strncmp(request, "dump", 4) == 0 ? dump() : @{@"error": @"request"};
  NSData *json = [NSJSONSerialization dataWithJSONObject:reply options:0 error:nil]
                     ?: [@"{\"error\":\"json\"}" dataUsingEncoding:NSUTF8StringEncoding];
  const char *at = json.bytes, *end = at + json.length;
  for (ssize_t w = 0; at < end && (w = write(client, at, (size_t)(end - at))) > 0;) at += w;
  close(client);
}

/** What accepts a client, held for as long as the app runs. */
static dispatch_source_t listener;

__attribute__((constructor)) static void start(void) {
  const char *path = getenv("APPDYNO_VIEW_SOCKET");
  struct sockaddr_un addr = {.sun_family = AF_UNIX};
  if (!path || strlen(path) >= sizeof addr.sun_path) return;
  strlcpy(addr.sun_path, path, sizeof addr.sun_path);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return;
  // the socket an earlier process of the app listened on; the folder is the Mac user's alone
  unlink(path);
  if (bind(fd, (struct sockaddr *)&addr, sizeof addr) != 0 || chmod(path, 0600) != 0 ||
      listen(fd, 4) != 0) {
    close(fd);
    return;
  }
  dispatch_queue_t queue = dispatch_queue_create("dev.appdyno.viewprobe", DISPATCH_QUEUE_SERIAL);
  listener = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)fd, 0, queue);
  dispatch_source_set_event_handler(listener, ^{
    int client = accept(fd, NULL, NULL);
    if (client >= 0) serve(client);
  });
  dispatch_resume(listener);
}
