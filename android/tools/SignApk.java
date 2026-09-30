import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * Signs (v2) and verifies an APK with Google's apksig library — the same
 * code the SDK's `apksigner` runs, without needing build-tools installed.
 *
 *   java -cp apksig.jar:. SignApk <keystore> <storepass> <alias> <in.apk> <out.apk> <minSdk>
 */
public class SignApk {
    public static void main(String[] a) throws Exception {
        if (a.length != 6) throw new IllegalArgumentException("usage: SignApk keystore storepass alias in out minSdk");
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(a[0])) { ks.load(in, a[1].toCharArray()); }
        PrivateKey key = (PrivateKey) ks.getKey(a[2], a[1].toCharArray());
        X509Certificate cert = (X509Certificate) ks.getCertificate(a[2]);
        ApkSigner.SignerConfig signer =
            new ApkSigner.SignerConfig.Builder("CERT", key, Collections.singletonList(cert)).build();
        File out = new File(a[4]);
        new ApkSigner.Builder(Collections.singletonList(signer))
            .setInputApk(new File(a[3]))
            .setOutputApk(out)
            .setMinSdkVersion(Integer.parseInt(a[5]))
            // v1 (JAR signing) is only needed below Android 7.0 / API 24, where v2
            // was introduced; minSdk is 24. apksig 2.3.0's v1 path also calls JDK
            // internals that were removed in Java 17+.
            .setV1SigningEnabled(false)
            .setV2SigningEnabled(true)
            .setCreatedBy("ledgerline build-apk")
            .build()
            .sign();

        ApkVerifier.Result r = new ApkVerifier.Builder(out).build().verify();
        for (Object e : r.getErrors()) System.err.println("ERROR: " + e);
        if (!r.isVerified()) { System.err.println("verification FAILED"); System.exit(1); }
        System.out.println("signed + verified: v2=" + r.isVerifiedUsingV2Scheme());
    }
}
