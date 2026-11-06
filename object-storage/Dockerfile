FROM alpine:3.22

ARG TARGETARCH

RUN apk add --no-cache ca-certificates curl tar \
    && case "$TARGETARCH" in \
         amd64) archive=rustfs-cli-linux-amd64-v0.1.37.tar.gz; digest=31e79fe7697c870e60f5b5c9008adbb3ad5af7f9f2ab45a3d68585c5f87238d1 ;; \
         arm64) archive=rustfs-cli-linux-arm64-v0.1.37.tar.gz; digest=a02091205fe4d9fbf0d16a0dac3d46ad7fac7d5266024b5b17e76327a4e88aa8 ;; \
         *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl --fail --location --silent --show-error "https://github.com/rustfs/cli/releases/download/v0.1.37/$archive" -o /tmp/rc.tar.gz \
    && echo "$digest  /tmp/rc.tar.gz" | sha256sum -c -s \
    && mkdir /tmp/rc-unpack \
    && tar -xzf /tmp/rc.tar.gz -C /tmp/rc-unpack \
    && install -m 0755 /tmp/rc-unpack/rc /usr/local/bin/rc \
    && rm -rf /tmp/rc-unpack /tmp/rc.tar.gz

COPY init-app.sh /usr/local/bin/init-app
RUN chmod 0755 /usr/local/bin/init-app

ENTRYPOINT ["/usr/local/bin/init-app"]
