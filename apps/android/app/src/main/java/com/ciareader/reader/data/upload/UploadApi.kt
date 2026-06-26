package com.ciareader.reader.data.upload

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path

/** Text/EPUB/PDF import endpoints under /api/v1/texts. */
interface UploadApi {
    /** Plain text (paste or `.txt`) → JSON body. Returns the new text metadata. */
    @POST("api/v1/texts")
    suspend fun createText(@Body body: CreateTextRequest): CreateTextResponseDto

    /**
     * EPUB → multipart/form-data with `language`, `title`, and the `file` blob.
     * The server falls back to the filename when `title` is blank, but we always
     * send a non-blank title from the picker so the field is required here.
     */
    @Multipart
    @POST("api/v1/texts/epub")
    suspend fun uploadEpub(
        @Part("language") language: RequestBody,
        @Part("title") title: RequestBody,
        @Part file: MultipartBody.Part,
    ): EpubUploadResponseDto

    /** Opens a PDF import (text + N empty page chapters). Returns the new text id. */
    @POST("api/v1/texts/pdf/begin")
    suspend fun pdfBegin(@Body body: PdfBeginRequest): PdfBeginResponseDto

    /** Ingest one rasterized PDF page; the server OCRs it and flips the text to
     *  `ready` after the final page. */
    @Multipart
    @POST("api/v1/texts/{id}/pages/{idx}")
    suspend fun uploadPage(
        @Path("id") textId: String,
        @Path("idx") idx: Int,
        @Part image: MultipartBody.Part,
        @Part("width") width: RequestBody,
        @Part("height") height: RequestBody,
    ): PageUploadResponseDto
}
