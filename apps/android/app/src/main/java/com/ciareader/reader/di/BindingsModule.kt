package com.ciareader.reader.di

import com.ciareader.reader.core.auth.DataStoreTokenStore
import com.ciareader.reader.core.auth.TokenStore
import com.ciareader.reader.core.settings.DataStoreSettingsStore
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.auth.AuthRepository
import com.ciareader.reader.data.auth.AuthRepositoryImpl
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.language.LanguageRepositoryImpl
import com.ciareader.reader.data.library.LibraryRepository
import com.ciareader.reader.data.library.LibraryRepositoryImpl
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionRepositoryImpl
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.DictionaryRepositoryImpl
import com.ciareader.reader.data.local.OfflineCache
import com.ciareader.reader.data.local.RoomOfflineCache
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderRepositoryImpl
import com.ciareader.reader.data.upload.ContentResolverDocumentReader
import com.ciareader.reader.data.upload.DocumentReader
import com.ciareader.reader.data.upload.PdfRasterizer
import com.ciareader.reader.data.upload.PdfRendererRasterizer
import com.ciareader.reader.data.upload.UploadRepository
import com.ciareader.reader.data.upload.UploadRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class BindingsModule {

    @Binds
    @Singleton
    abstract fun bindTokenStore(impl: DataStoreTokenStore): TokenStore

    @Binds
    @Singleton
    abstract fun bindSettingsStore(impl: DataStoreSettingsStore): SettingsStore

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindLibraryRepository(impl: LibraryRepositoryImpl): LibraryRepository

    @Binds
    @Singleton
    abstract fun bindLanguageRepository(impl: LanguageRepositoryImpl): LanguageRepository

    @Binds
    @Singleton
    abstract fun bindReaderRepository(impl: ReaderRepositoryImpl): ReaderRepository

    @Binds
    @Singleton
    abstract fun bindCollectionRepository(impl: CollectionRepositoryImpl): CollectionRepository

    @Binds
    @Singleton
    abstract fun bindDictionaryRepository(impl: DictionaryRepositoryImpl): DictionaryRepository

    @Binds
    @Singleton
    abstract fun bindOfflineCache(impl: RoomOfflineCache): OfflineCache

    @Binds
    @Singleton
    abstract fun bindUploadRepository(impl: UploadRepositoryImpl): UploadRepository

    @Binds
    @Singleton
    abstract fun bindDocumentReader(impl: ContentResolverDocumentReader): DocumentReader

    @Binds
    @Singleton
    abstract fun bindPdfRasterizer(impl: PdfRendererRasterizer): PdfRasterizer
}
