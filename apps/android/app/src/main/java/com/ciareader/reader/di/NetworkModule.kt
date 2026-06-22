package com.ciareader.reader.di

import com.ciareader.reader.BuildConfig
import com.ciareader.reader.core.network.AuthInterceptor
import com.ciareader.reader.core.network.TokenAuthenticator
import com.ciareader.reader.data.auth.AuthApi
import com.ciareader.reader.data.auth.TokenRefreshApi
import com.ciareader.reader.data.language.LanguagesApi
import com.ciareader.reader.data.library.LibraryApi
import com.ciareader.reader.data.collection.CollectionsApi
import com.ciareader.reader.data.reader.ReaderApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import javax.inject.Qualifier
import javax.inject.Singleton

/** OkHttp/Retrofit configured WITH the bearer interceptor + refresh authenticator. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class Authenticated

/** Bare OkHttp/Retrofit used only by the refresh call (no authenticator → no recursion). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class Refresh

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): HttpLoggingInterceptor =
        HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

    @Provides
    @Singleton
    @Refresh
    fun provideRefreshClient(logging: HttpLoggingInterceptor): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(logging)
            .build()

    @Provides
    @Singleton
    @Refresh
    fun provideRefreshRetrofit(@Refresh client: OkHttpClient, json: Json): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(JSON_MEDIA_TYPE))
            .build()

    @Provides
    @Singleton
    fun provideTokenRefreshApi(@Refresh retrofit: Retrofit): TokenRefreshApi =
        retrofit.create(TokenRefreshApi::class.java)

    @Provides
    @Singleton
    @Authenticated
    fun provideAuthenticatedClient(
        logging: HttpLoggingInterceptor,
        authInterceptor: AuthInterceptor,
        authenticator: TokenAuthenticator,
    ): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .authenticator(authenticator)
            .addInterceptor(logging)
            .build()

    @Provides
    @Singleton
    @Authenticated
    fun provideAuthenticatedRetrofit(@Authenticated client: OkHttpClient, json: Json): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(JSON_MEDIA_TYPE))
            .build()

    @Provides
    @Singleton
    fun provideAuthApi(@Authenticated retrofit: Retrofit): AuthApi =
        retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun provideLibraryApi(@Authenticated retrofit: Retrofit): LibraryApi =
        retrofit.create(LibraryApi::class.java)

    @Provides
    @Singleton
    fun provideLanguagesApi(@Authenticated retrofit: Retrofit): LanguagesApi =
        retrofit.create(LanguagesApi::class.java)

    @Provides
    @Singleton
    fun provideReaderApi(@Authenticated retrofit: Retrofit): ReaderApi =
        retrofit.create(ReaderApi::class.java)

    @Provides
    @Singleton
    fun provideCollectionsApi(@Authenticated retrofit: Retrofit): CollectionsApi =
        retrofit.create(CollectionsApi::class.java)

    private val JSON_MEDIA_TYPE = "application/json".toMediaType()
}
