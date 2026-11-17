// Where the app and its windows keep what a person chose. macOS keeps a domain by the app's id whatever home a process
// is given, so a test's run names a domain of its own by APPDYNO_DEFAULTS, and a person's choices stay as they were.
#import "Defaults.h"
#import "Updates.h"

static NSString *_Nullable testDomain(void) {
  NSString *named = NSProcessInfo.processInfo.environment[@"APPDYNO_DEFAULTS"];
  return named.length ? named : nil;
}

BOOL MVDefaultsAreATest(void) {
  return testDomain() != nil;
}

NSUserDefaults *MVDefaults(void) {
  static NSUserDefaults *kept;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *test = testDomain();
    kept = test ? [[NSUserDefaults alloc] initWithSuiteName:test] : NSUserDefaults.standardUserDefaults;
  });
  return kept;
}

NSUserDefaults *MVAppDefaults(void) {
  static NSUserDefaults *kept;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    kept = [[NSUserDefaults alloc] initWithSuiteName:testDomain() ?: MVAppDomain];
  });
  return kept;
}
