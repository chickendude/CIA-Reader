# OkHttp / Retrofit
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keepclasseswithmembers class * { @retrofit2.http.* <methods>; }

# kotlinx.serialization — keep generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keep,includedescriptorclasses class com.ciareader.reader.**$$serializer { *; }
-keepclassmembers class com.ciareader.reader.** {
    *** Companion;
}
-keepclasseswithmembers class com.ciareader.reader.** {
    kotlinx.serialization.KSerializer serializer(...);
}
