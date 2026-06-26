package com.ciareader.reader.data.collection

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.Path

interface CollectionsApi {
    @GET("api/v1/me/collections")
    suspend fun myCollections(): MyCollectionsDto

    @GET("api/v1/collections/{id}")
    suspend fun detail(@Path("id") collectionId: String): CollectionDetailDto

    @PATCH("api/v1/collections/{id}")
    suspend fun update(
        @Path("id") collectionId: String,
        @Body body: UpdateCollectionRequest,
    ): UpdateCollectionResponseDto

    @DELETE("api/v1/collections/{id}")
    suspend fun delete(@Path("id") collectionId: String): OkResponseDto
}
