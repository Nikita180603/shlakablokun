FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY kd-server /app/kd-server
COPY index.html robots.txt sitemap.xml /app/
COPY css /app/css
COPY js /app/js
COPY img /app/img
COPY admin /app/admin
RUN mkdir -p /app/data /app/img/custom && chmod +x /app/kd-server
ENV KD_ADDR=0.0.0.0:4173
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:4173/healthz || exit 1
VOLUME ["/app/data"]
CMD ["/app/kd-server"]
