#!/bin/sh
# Pavois — flux video seul, en MJPEG sur HTTP.
#
# CHANGEMENT : le port passe de 8080 a 8081. Le 8080 est desormais pris par
# pavois_web.py, qui sert la page complete (video + IMU). La video reste servie
# telle quelle, sans re-encodage (-c copy) : le Pi ne fait quasiment rien.
#
# -listen 1 = un seul client a la fois ; ffmpeg s'arrete quand le client se
# deconnecte, d'ou la boucle while qui le relance (elle relance aussi si la
# camera plante).

PORT=8081

while true; do
  rpicam-vid -t 0 --codec mjpeg --width 1280 --height 720 --framerate 1000 --nopreview -o - \
  | ffmpeg -loglevel warning -f mjpeg -i - -c copy -f mpjpeg \
    -content_type "multipart/x-mixed-replace;boundary=ffmpeg" \
    -listen 1 "http://0.0.0.0:${PORT}/stream"
  sleep 1
done
