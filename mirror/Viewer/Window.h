#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

/// The picture's view: what a person's mouse, trackpad and keys land on.
@interface MVView : NSView
@property(nonatomic) CGSize picture;
@property(nonatomic) BOOL inputOn;
@end

NS_ASSUME_NONNULL_END
