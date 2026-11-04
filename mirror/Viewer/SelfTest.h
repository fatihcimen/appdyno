#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

@interface MVTestFrame : NSObject
@property(nonatomic) NSData *data;
@property(nonatomic) BOOL key;
@end

/// `count` frames in Annex B, a keyframe every `keyEvery`; nil where this Mac has no such encoder.
NSArray<MVTestFrame *> *_Nullable MVEncodeFrames(BOOL hevc, int count, int keyEvery);

void MVCheck(NSString *name, BOOL ok, NSString *_Nullable detail);
void MVSkip(NSString *name, NSString *why);

/// A sink that counts, and lets a check wait until a count is reached.
@interface MVTestSink : NSObject <MVSink>
@property(atomic) int images, surfaces, sizes;
@property(atomic, copy, nullable) NSString *lost;
@property(atomic) CGSize lastSize;
@property(atomic, copy, nullable) NSString *lastCodec;
@property(atomic) OSType lastFormat;
@property(atomic, nullable) id lastImage;
@property(atomic, nullable) id lastSurface;
@property(atomic) int keyRequests, lastFailures;
- (BOOL)waitForKeyRequests:(int)count;
- (BOOL)waitForImages:(int)count;
- (BOOL)waitForLost;
@end

void MVCheckPixels(void);
void MVCheckPipe(void);
void MVCheckRecorder(void);
void MVCheckKeyboard(void);

NS_ASSUME_NONNULL_END
