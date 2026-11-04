package dev.appdyno.agent

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

class AccessibilityRead(private val capture: TreeCapture, private val settling: Settling) {
    /**
     * A tree read with what an accessibility audit needs besides: each node's traversal hints (resolved
     * after the walk from the nodes it fetched, within TRAVERSAL_MS) and, for its first `maxNodes` visible
     * text nodes, how many characters the screen does not show (one call to the app per node, within
     * TEXT_CLIP_MS).
     */
    fun read(max: Int, job: Job): Reply {
        val index = HashMap<android.view.accessibility.AccessibilityNodeInfo, Int>()
        val texts = ArrayList<Pair<Int, android.view.accessibility.AccessibilityNodeInfo>>()
        val c = capture.capture(yielding = !settling.idle(job), onNode = { i, n ->
            index[n] = i
            if (texts.size < max && n.isVisibleToUser && !n.isEditable && !n.text.isNullOrEmpty()) texts += i to n
        })
        val traversal = JSONArray()
        val tEnd = SystemClock.uptimeMillis() + TRAVERSAL_MS
        for ((n, i) in index) {
            if (job.cancelled || SystemClock.uptimeMillis() > tEnd) break
            // a node without hints answers at once; one with hints is looked up (cached by the walk)
            val before = n.traversalBefore?.let { index[it] }
            val after = n.traversalAfter?.let { index[it] }
            if (before == null && after == null) continue
            traversal.put(Results.traversal(i, before, after))
        }
        val clips = JSONArray()
        val end = SystemClock.uptimeMillis() + TEXT_CLIP_MS
        for ((i, n) in texts) {
            if (job.cancelled || SystemClock.uptimeMillis() > end) break
            val (chars, hidden) = TextClip.of(n) ?: continue
            clips.put(Results.clip(i, chars, hidden))
        }
        return Reply(JSONObject().put("tree", settling.treeJson(c)).put("clips", clips).put("traversal", traversal))
    }

    private companion object {
        /** Its character lookups stop after this long (the tree read is not counted). */
        const val TEXT_CLIP_MS = 1_500L
        /** Its traversal hints are resolved for this long at most. */
        const val TRAVERSAL_MS = 300L
    }
}
