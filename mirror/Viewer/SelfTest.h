#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

@interface MVTestFrame : NSObject
@property(nonatomic) NSData *data;
@property(nonatomic) BOOL key;
@end

/// `count` frames in Annex B, a keyframe every `keyEvery`; nil where this Mac has no such encoder.
NSArray<MVTestFrame *> *_Nullable MVEncodeFrames(BOOL hevc, int count, int keyEvery);

NS_ASSUME_NONNULL_END
