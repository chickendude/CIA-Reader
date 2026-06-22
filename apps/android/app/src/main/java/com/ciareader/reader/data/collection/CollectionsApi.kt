package com.ciareader.reader.data.collection

import retrofit2.http.GET
import retrofit2.http.Path

interface CollectionsApi {
    @GET("api/v1/me/collections")
    suspend fun myCollections(): MyCollectionsDto

    @GET("api/v1/collections/{id}")
    suspend fun detail(@Path("id") collectionId: String): CollectionDetailDto
}
