package com.ciareader.reader.di

import com.ciareader.reader.core.auth.DataStoreTokenStore
import com.ciareader.reader.core.auth.TokenStore
import com.ciareader.reader.data.auth.AuthRepository
import com.ciareader.reader.data.auth.AuthRepositoryImpl
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.language.LanguageRepositoryImpl
import com.ciareader.reader.data.library.LibraryRepository
import com.ciareader.reader.data.library.LibraryRepositoryImpl
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
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindLibraryRepository(impl: LibraryRepositoryImpl): LibraryRepository

    @Binds
    @Singleton
    abstract fun bindLanguageRepository(impl: LanguageRepositoryImpl): LanguageRepository
}
