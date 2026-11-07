// What Help says of the hub's words and of what goes wrong.
#import "HubParts.h"

NS_ASSUME_NONNULL_BEGIN

/// Each a word as the hub shows it, and what it means.
NSArray<NSArray<NSString *> *> *MVHelpMeanings(void);
/// Each what a person sees, and what to do.
NSArray<NSArray<NSString *> *> *MVHelpFailures(void);

NS_ASSUME_NONNULL_END
