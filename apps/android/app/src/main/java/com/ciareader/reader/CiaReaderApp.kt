package com.ciareader.reader

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.ciareader.reader.di.Authenticated
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject

@HiltAndroidApp
class CiaReaderApp : Application(), ImageLoaderFactory {
    // The authenticated client (Bearer + token refresh) so Coil can fetch
    // owner-gated PDF page images from /pdf-assets. Injected by Hilt before the
    // first image load triggers newImageLoader().
    @Inject
    @Authenticated
    lateinit var okHttpClient: OkHttpClient

    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .okHttpClient(okHttpClient)
            .build()
}
