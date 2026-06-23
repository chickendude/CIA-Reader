package com.ciareader.reader.di

import android.content.Context
import androidx.room.Room
import com.ciareader.reader.data.local.AppDatabase
import com.ciareader.reader.data.local.LibraryCacheDao
import com.ciareader.reader.data.local.ReaderCacheDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "ciareader-cache.db")
            // The DB is a disposable mirror of the server, so on a schema bump
            // we rebuild rather than migrate.
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    @Singleton
    fun provideReaderCacheDao(db: AppDatabase): ReaderCacheDao = db.readerCacheDao()

    @Provides
    @Singleton
    fun provideLibraryCacheDao(db: AppDatabase): LibraryCacheDao = db.libraryCacheDao()
}
