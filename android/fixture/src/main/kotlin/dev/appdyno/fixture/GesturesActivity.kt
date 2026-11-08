package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView

/** Says what a finger did on the pad: double taps, how far the last path went, how many fingers. */
class GesturesActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val out = label("double taps: 0")
            var doubles = 0
            var fingers = 0
            var travel = 0
            var startY = 0f
            val show = { out.text = "double taps: $doubles; travel: $travel; fingers: $fingers" }
            val detector = android.view.GestureDetector(
                context,
                object : android.view.GestureDetector.SimpleOnGestureListener() {
                    override fun onDown(e: android.view.MotionEvent) = true
                    override fun onDoubleTap(e: android.view.MotionEvent): Boolean {
                        doubles++
                        show()
                        return true
                    }
                },
            )
            View(context).apply {
                contentDescription = "Gesture pad"
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1400)
                setOnTouchListener { _, e ->
                    detector.onTouchEvent(e)
                    when (e.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> {
                            startY = e.y
                            fingers = 1
                        }

                        android.view.MotionEvent.ACTION_POINTER_DOWN -> fingers = maxOf(fingers, e.pointerCount)

                        android.view.MotionEvent.ACTION_UP -> {
                            travel = (e.y - startY).toInt()
                            show()
                        }
                    }
                    true
                }
                addView(this)
            }
        }
    }
}

open class ListActivity : Activity() {
    private val counts = IntArray(60)
    protected open val listId = R.id.list

    /** When a row comes into the list, for a screen that makes it cost something. */
    protected open fun onRow(position: Int) = Unit

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val list = ListView(this).apply { id = listId }
        list.adapter = object : BaseAdapter() {
            override fun getCount() = counts.size
            override fun getItem(position: Int) = position
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
                onRow(position)
                val row = LinearLayout(this@ListActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(24, 24, 24, 24)
                }
                TextView(this@ListActivity).apply {
                    id = R.id.row_name
                    text = "Product ${position + 1}"
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    row.addView(this)
                }
                val count = TextView(this@ListActivity).apply {
                    id = R.id.row_count
                    text = "In basket: ${counts[position]}"
                    row.addView(this)
                }
                Button(this@ListActivity).apply {
                    id = R.id.add_button
                    text = "Add"
                    setOnClickListener {
                        counts[position]++
                        count.text = "In basket: ${counts[position]}"
                    }
                    row.addView(this)
                }
                return row
            }
        }
        setContentView(list)
    }
}
