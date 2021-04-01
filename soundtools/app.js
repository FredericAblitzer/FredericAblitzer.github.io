var document;

document.onkeydown = checkKey;


//webkitURL is deprecated but nevertheless
URL = window.URL || window.webkitURL;

var select_fmax = document.getElementById("select_fmax");
var slider_vitesse = document.getElementById("slider_vitesse");
var select_curseur = document.getElementById("select_curseur");
var select_curseur_1 = document.getElementById("select_curseur_1");
var select_Nfft = document.getElementById("select_Nfft");
var select_gain = document.getElementById("select_gain");


var v = document.getElementById('v');
v.addEventListener("play", play);
v.addEventListener("pause", stop);

var sidebar = document.getElementById('sidebar');
var togglebutton = document.getElementById('toggle');

togglebutton.addEventListener('click', _ => {
  sidebar.classList.toggle('collapsed');
});


let mindB = -80
let dyn = 60

// MERITE -------------------------------------
// // spectrogramme
// mindB = -80
// dyn = 50
// // spectre
// mindB = -150
// dyn = 150
// --------------------------------------------


// "Variables" imposées
var Nfft = 8192; // (185.8 ms)
var Nfreq; // nombre de fréquences récupérées avec getByteFrequencyData
var Fe = 44100; // fréquence d'échantillonnage (réellement imposée)
var notes = ['la', 'la#', 'si', 'do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si', 'do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la'];
var ImagesNotes = ["note_A3.svg", "note_A3sharp.svg", "note_B3.svg", "note_C4.svg", "note_C4sharp.svg", "note_D4.svg", "note_D4sharp.svg", "note_E4.svg", "note_F4.svg", "note_F4sharp.svg", "note_G4.svg", "note_G4sharp.svg", "note_A4.svg", "note_A4sharp.svg", "note_B4.svg", "note_C5.svg", "note_C5sharp.svg", "note_D5.svg", "note_D5sharp.svg", "note_E5.svg", "note_F5.svg", "note_F5sharp.svg", "note_G5.svg", "note_G5sharp.svg", "note_A5.svg"];

// Variables paramétrables
var dx_timefreq;
var dx_spectre;
var px_par_s; // nombre de pixels par seconde
var fcurseur = 440; // frequence du curseur
var Nfreqmax;
var curseur_harmonique; // booléen (0 / 1)
var trig_level = 0.8;
var son = 0;
var waitingfortrigger = false;
var ismes1 = false;
var ismes2 = false;
var ismes3 = false;
var notecurseur = notes[Math.round((Math.log(fcurseur / 440) / Math.log(2) * 12) % 12) + 12];
var imgcurseur = ImagesNotes[Math.round((Math.log(fcurseur / 440) / Math.log(2) * 12) % 12) + 12];
var couleurcurseur;
var imageloaded;
var gain = 1
var toc = 0
var mode_clic = 'curseur';
var pause = false;
var sourceWAV;
var t0;
var t;
var list_f;

// Définition de certaines constantes
// utiles pour le fenêtrage
const alpha = 0.16;
const a0 = (1-alpha)/2;
const a1 = 1/2;
const a2 = alpha/2;




ImageLoader(ImagesNotes, function(result) {
	if (result.error) {
		// outputs: ["example.png", "example.jpg"]
		console.log("The following images couldn't be properly loaded: ", result.error);

	}

	// outputs: ["http://i.imgur.com/fHyEMsl.jpg"]
	console.log("The following images were succesfully loaded: ", result.success);

	if (result.error.length > 0) {
		imageloaded = false;
	} else {
		imageloaded = true;
	}

});




// Initialisation des canvas *******************************************

// canvas principal
var canvas = document.getElementById('visualizer');
var ctx = canvas.getContext('2d');
// redimensionnement
ctx.canvas.width = window.innerWidth;
ctx.canvas.height = 0.8 * window.innerHeight;
//ctx.canvas.width = 1066
//ctx.canvas.height = 480//+100//0.9 * window.innerHeight;
var WIDTH = canvas.width;
var HEIGHT = canvas.height;
HEIGHT1 = Math.round(0.10 * HEIGHT);
HEIGHT2 = HEIGHT - HEIGHT1;

// // MERITE ----------------------------------
// // spectrogramme
// HEIGHT1 = 100;
// HEIGHT2 = 378;
// HEIGHT = HEIGHT1 + HEIGHT2;
// ctx.canvas.height = HEIGHT;
// // spectre
// HEIGHT1 = 100;
// HEIGHT2 = 706-100;
// HEIGHT = HEIGHT1 + HEIGHT2;
// ctx.canvas.height = HEIGHT;
// WIDTH = 652;
// ctx.canvas.width = WIDTH;
// // -----------------------------------------

// copie du canvas principal (pour défilement)
var tempcanvas = document.createElement('canvas')
//var tempcanvas = document.querySelector('.copie'); // si travail sur un canvas visible
tempcanvas.width = WIDTH;
tempcanvas.height = HEIGHT;
var tempctx = tempcanvas.getContext("2d");


var rect = canvas.getBoundingClientRect();


// Initialisation des boutons et modes d'interaction



document.getElementById('bouton_wav').addEventListener('click', load_wav);
//document.getElementById('bouton_song2').addEventListener('click', play_song);
document.getElementById('bouton_pause').addEventListener('click', stop);
document.getElementById('bouton_time_freq').addEventListener('click', change_visu);
document.getElementById('bouton_freq').addEventListener('click', change_visu);
document.getElementById('bouton_mindBminus').addEventListener('click', modifminmaxdB);
document.getElementById('bouton_mindBplus').addEventListener('click', modifminmaxdB);
document.getElementById('bouton_dynminus').addEventListener('click', modifminmaxdB);
document.getElementById('bouton_dynplus').addEventListener('click', modifminmaxdB);
document.getElementById('bouton_tap').addEventListener('click', start_trig);
document.getElementById('bouton_screenshot').addEventListener('click', screenshot);


function screenshot(e) {
	document.getElementById('lien_screenshot').href = canvas.toDataURL();
  document.getElementById('lien_screenshot').download = "capture.png";
}



var fps = 60;
//var T = WIDTH/dx*16.6/1000 // temps en seconde pour balayer tout l'écran





//function init() {

// Older browsers might not implement mediaDevices at all, so we set an empty object first
if (navigator.mediaDevices === undefined) {
	navigator.mediaDevices = {};
}


// Some browsers partially implement mediaDevices. We can't just assign an object
// with getUserMedia as it would overwrite existing properties.
// Here, we will just add the getUserMedia property if it's missing.
if (navigator.mediaDevices.getUserMedia === undefined) {
	navigator.mediaDevices.getUserMedia = function(constraints) {

		// First get ahold of the legacy getUserMedia, if present
		var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

		// Some browsers just don't implement it - return a rejected promise with an error
		// to keep a consistent interface
		if (!getUserMedia) {
			return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
		}

		// Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
		return new Promise(function(resolve, reject) {
			getUserMedia.call(navigator, constraints, resolve, reject);
		});
	}
}



// set up forked web audio context, for multiple browsers
// window. is needed otherwise Safari explodes



var contexteAudio = new(window.AudioContext || window.webkitAudioContext)();
console.log(contexteAudio.sampleRate); // fréquence d'échantillonnage pour vérif

Fe = contexteAudio.sampleRate;
console.log('test')

var splitter = contexteAudio.createChannelSplitter(2);
var voiceSelect = document.getElementById("voice");
var source;
var stream;
var osc;


//var nombreFrames = contexteAudio.sampleRate * 5;
//var bufferAudio = contexteAudio.createBuffer(2, nombreFrames, contexteAudio.sampleRate);



//set up the different audio nodes we will use for the app

var analyser = contexteAudio.createAnalyser();
analyser.smoothingTimeConstant = 0;
analyser.fftSize = Nfft;



var analyser1 = contexteAudio.createAnalyser();
analyser1.minDecibels = -90; //-90
analyser1.maxDecibels = 0; //-10
analyser1.smoothingTimeConstant = 0;
analyser1.fftSize = 256;



var visualSelect = document.getElementById("visual");


var drawVisual; // variable utile pour les animations (requestAnimationFrame)




var mouseClicked = false;
var mouseReleased = true;
canvas.addEventListener("mousemove", onMouseMove, false);
canvas.addEventListener("mousedown", onMouseDown, false);
canvas.addEventListener("mouseup", onMouseUp, false);


init()

//main block for doing the audio recording

if (navigator.mediaDevices.getUserMedia) {
	console.log('getUserMedia supported.');
	var constraints = {
		audio: {channelCount: 2,echoCancellation: false,noiseSuppression: false,autoGainControl: false}
	}
	navigator.mediaDevices.getUserMedia(constraints)
		.then(
			function(stream) {
				source = contexteAudio.createMediaStreamSource(stream);


				//source.connect(analyser);
				osc = contexteAudio.createOscillator();
				osc.type = 'Sine';
				osc.start(0);

				source.connect(splitter); // commenter si MERITE


        var voie = select_voie.value;

        // Connect graph.
      	if (voie == 'left') {
      		splitter.connect(analyser, 0);
      		splitter.connect(analyser1, 0);
      	} else {
      		splitter.connect(analyser, 1);
      		splitter.connect(analyser1, 1);
      	}

        t0 = Date.now();
				visualize();
			})
		.catch(function(err) {
			console.log('The following gUM error occured: ' + err);
		})
} else {
	console.log('getUserMedia not supported on your browser!');
}


function visualize() {


	var visualSetting = visualSelect.value;

	if (visualSetting === "temporel") {
		var bufferLength = analyser.fftSize;
		var dataTime = new Float32Array(bufferLength);

		ctx.clearRect(0, 0, WIDTH, HEIGHT);

		var draw = function() {

			drawVisual = requestAnimationFrame(draw);

			analyser.getFloatTimeDomainData(dataTime);

			// application d'un gain
			dataTime.forEach(function(val, i) {
				dataTime[i] = val * gain;
			});


			if (!pause) {
				ctx.fillStyle = 'rgb(0, 0, 0)';
				ctx.fillRect(0, 0, WIDTH, HEIGHT);

				ctx.lineWidth = 1;


				// Tracé du niveau de trigger
				ctx.beginPath();
				ctx.moveTo(0, HEIGHT - trig_level * HEIGHT);
				ctx.lineTo(WIDTH, HEIGHT - trig_level * HEIGHT);
				ctx.strokeStyle = "magenta";
				ctx.lineWidth = 1;
				ctx.stroke();


				ctx.strokeStyle = 'rgb(255, 255, 255)';
				ctx.beginPath();

				var sliceWidth = WIDTH * 1.0 / bufferLength;
				var x = 0;

				for (var i = 0; i < bufferLength; i++) {

					var y = (dataTime[i] / 2 + 0.5) * HEIGHT;

					if (i === 0) {
						ctx.moveTo(x, y);
					} else {
						ctx.lineTo(x, y);
					}

					if (waitingfortrigger && x < 0.55 * WIDTH && (dataTime[i] / 2 + 0.5) > trig_level) {


						window.cancelAnimationFrame(drawVisual);
						visualSelect.value = "spectre";
						//visualSetting = "spectre";
						//drawSpectrum()
						//stop()
						visualize();
						//stop();
						waitingfortrigger = false;
						//window.cancelAnimationFrame(drawVisual);
						//visualize();
						break;

					}

					x += sliceWidth;
				}

				ctx.lineTo(canvas.width, canvas.height / 2);
				ctx.stroke();
			};

      if (waitingfortrigger) {
        ctx.fillStyle = 'rgb(255, 255, 255, 0.5)';
        ctx.font = "4em guitar-bold";
        ctx.textAlign = "center";
        ctx.fillText('...', WIDTH/2, HEIGHT/3);
      }

		}

		draw();

	} else if (visualSetting == "spectrogramme") {

		dy = HEIGHT2 / Nfreqmax


		var dataFreq = new Uint8Array(Nfreq);

		var bufferLength = analyser1.fftSize; //dev
		var dataTime = new Uint8Array(bufferLength); //dev

		var drawSpectro = function(now) {

			ctx.clearRect(0, 0, WIDTH, HEIGHT); // effacement du canvas


			drawVisual = requestAnimationFrame(drawSpectro);

			analyser.getByteFrequencyData(dataFreq);
			analyser1.getByteTimeDomainData(dataTime);

			// collage CANVAS vers CANVAS TEMPORAIRE
			tempctx.drawImage(canvas, 0, 0, WIDTH, HEIGHT);

			var minval = Math.min.apply(null, dataTime);
			var maxval = Math.max.apply(null, dataTime);


			//sconsole.log((255-maxval)/255*HEIGHTW)
			couleurcurseur = "white";


			if (!pause) {

				// remplissage d'une ligne verticale
				for (var i = 0; i < Nfreqmax; i++) {
					ctx.fillStyle = colormap(dataFreq[i]);
					//ctx.fillStyle = 'black';
					ctx.fillRect(WIDTH - dx_timefreq, HEIGHT - i * dy, dx_timefreq, dy);
				}




				ctx.fillStyle = '#000';
				ctx.fillRect(WIDTH - dx_timefreq, 0, dx_timefreq, HEIGHT1);
				//console.log('max ='+maxval+' | min ='+minval+' | diff='+(maxval-minval))
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(WIDTH - dx_timefreq, (255 - maxval) / 255 * HEIGHT1, dx_timefreq, Math.max(1, (maxval - minval) / 255 * HEIGHT1));

				if (false) {
					var buf = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(buf);
					var ac = autoCorrelate(buf, contexteAudio.sampleRate);
					if (ac > 0) {
						fcurseur = ac;
						updateNote();
						couleurcurseur = "yellow";
					}
				}

				//ycurseur = HEIGHT-fcurseur/fmax*HEIGHT2;
				//ctx.fillStyle = 'magenta';
				//ctx.fillRect(WIDTH - dx_timefreq, ycurseur, dx_timefreq, dy);


				// translation de la ligne verticale vers la gauche
				ctx.translate(-dx_timefreq, 0);

        t = Date.now() - t0;
			}




			// collage CANVAS TEMPORAIRE vers CANVAS
			ctx.drawImage(tempcanvas, 0, 0, WIDTH, HEIGHT);

			// Reset the transformation matrix.
			ctx.setTransform(1, 0, 0, 1, 0, 0);

			// collage CANVAS vers CANVAS TEMPORAIRE
			tempctx.drawImage(canvas, 0, 0, WIDTH, HEIGHT);


			// Tracé des repères temporels
			var xt = WIDTH
			while (xt > 0) {
				ctx.fillStyle = '#666666';
				ctx.fillRect(xt, HEIGHT - 10, 1, 10);
				ctx.fillRect(xt, HEIGHT1, 1, 10);
				xt -= px_par_s;
			}
      ctx.fillRect(0, HEIGHT1, WIDTH, 1);
      ctx.fillRect(0, HEIGHT-1, WIDTH, 1);


      // Tracé des repères fréquentiels
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(0, 0, 50+20, HEIGHT);

      let f = 0
      while (f <= fmax) {

        ctx.strokeStyle = 'rgb(255, 255, 255)';
        ctx.fillStyle = 'rgb(255, 255, 255)';


        if (f%500 == 0) {
          ctx.fillRect(50+10, HEIGHT - f / fmax * HEIGHT2, 10, 1);
          ctx.fillRect(WIDTH-10, HEIGHT - f / fmax * HEIGHT2, 10, 1);
          ctx.textAlign = "right";

          ctx.textBaseline = "middle";
          ctx.font = "16px guitar-bold";
          if (f==0) { ctx.textBaseline = "bottom"; ctx.font = "20px guitar-bold"; }
          if (f==fmax) { ctx.textBaseline = "top"; ctx.font = "20px guitar-bold"; }
          ctx.fillText(f, 50, HEIGHT - f / fmax * HEIGHT2);
        // } else {
          // ctx.fillRect(f*px_par_Hz, HEIGHT - 50, 1, 10);
        }

        f += 100;
      }
      ctx.fillRect(50+20, HEIGHT1, 1, HEIGHT2);




      if (select_curseur_1.value != 'none') {
			ycurseur = HEIGHT - fcurseur / fmax * HEIGHT2;

			// Tracé du curseur
      ctx.fillRect(50+20, ycurseur, WIDTH-50-20, 1);
      ctx.fillStyle = "#fdea14";
      ctx.fillRect(50+10, ycurseur-1, 10, 3);

			// et le texte associé
			ctx.font = "26px guitar-bold";
			ctx.textAlign = "left";
			ctx.strokeStyle = "black";
			ctx.lineWidth = 2;
			ctx.strokeText(''+fcurseur + " Hz (" + notecurseur + ")", 50+20+10, ycurseur - 2);
			ctx.fillStyle = couleurcurseur;
			ctx.fillText(''+fcurseur + " Hz (" + notecurseur + ")", 50+20+10, ycurseur - 2);


      // Curseurs multiples
      for (let i = 0; i < list_f.length; i++) {
        ycurseur1 = HEIGHT - list_f[i]*fcurseur / fmax * HEIGHT2;
        ctx.fillRect(50+20, ycurseur1, WIDTH-50-20, 1);
      }

      }

			// if (curseur_harmonique == 1) {
			// 	var n = 2;
      //
			// 	while (n * (HEIGHT - ycurseur) < HEIGHT2) {
			// 		ctx.beginPath();
			// 		ctx.moveTo(0, HEIGHT - n * (HEIGHT - ycurseur));
			// 		ctx.lineTo(WIDTH, HEIGHT - n * (HEIGHT - ycurseur));
			// 		ctx.strokeStyle = "red";
			// 		ctx.lineWidth = 1;
			// 		ctx.stroke();
      //
			// 		n++;
			// 	}
			// }



      var fps_count = Math.round(1000/(now-toc)*10)/10;
      toc = now;

      // affichage temps courant
      ctx.font = "26px guitar-bold";
      ctx.strokeStyle = "black";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";

      let t_min = Math.trunc(t / 60000);
      let t_s = Math.trunc((t - t_min * 60000) / 1000);
      let t_ms = t - t_min * 60000 - t_s * 1000;
      //ctx.strokeText(String('0' + t_min).slice(-2) + '\'\'' + String('0' + t_s).slice(-2) + '\'' + String('00' + t_ms).slice(-3), WIDTH-20, HEIGHT1+20);
      //ctx.fillText(String('0' + t_min).slice(-2) + '\'\'' + String('0' + t_s).slice(-2) + '\'' + String('00' + t_ms).slice(-3), WIDTH-20, HEIGHT1+20);


      //ctx.drawImage(v,70+10,HEIGHT1+10,320,160);


		};


		drawSpectro();

// -----------------------------------------------------------------------------
// SPECTRE
// -----------------------------------------------------------------------------
	} else if (visualSetting == "spectre") {

		var dataFreq = new Float32Array(Nfreq);

		//ctx.clearRect(0, 0, WIDTH, HEIGHT);

		var drawSpectrum = function(now) {

			drawVisual = requestAnimationFrame(drawSpectrum);

      var bufferLength = analyser.fftSize;




      // initialisation
      let sig_real = new Float32Array(bufferLength);
      let sig_imag = new Float32Array(bufferLength);

      analyser.getFloatTimeDomainData(sig_real); // récupération du signal temporel

      const w = new Float32Array(bufferLength); // initialisation de la fenêtre

      // définition de la fenêtre (dev futur : à précalculer ailleurs)
      for (let i = 0; i < bufferLength; i++) {
        w[i] = a0 - a1*Math.cos(2*Math.PI*i/bufferLength) + a2*Math.cos(4*Math.PI*i/bufferLength);
      }

      // application de la fenêtre
      for (let i = 0; i < bufferLength; i++) {
        sig_real[i] = sig_real[i]*w[i];
      }

      // zero padding
      //const kzero = 8; // facteur multiplicatif sur la durée du signal (multiple de 2 pour que ce soit rapide)
      //const kzero = Math.pow(2,nextpow2(WIDTH/Nfreqmax)-1);
      const kzero = 1;
      const N = kzero*bufferLength;
      const dx_fft = dx_spectre/kzero;

      //console.log('kzero = '+kzero)
      //console.log('dx_fft = '+dx_fft)
      if (kzero>1) {
        console.log((kzero-1)*bufferLength)
        const zeros = new Float32Array((kzero-1)*bufferLength);
        sig_real = [...sig_real, ...zeros];
        sig_imag = [...sig_imag, ...zeros];
      }

      transform(sig_real, sig_imag) // FFT

      // calcul du spectre (amplitude en dB)
      const spec_lin = new Float32Array(kzero*Nfreqmax);
      const spec = new Float32Array(kzero*Nfreqmax);
      for (let i = 0; i < kzero*Nfreqmax; i++) {
        spec_lin[i] = 1/bufferLength*Math.sqrt(Math.pow(sig_real[i],2)+Math.pow(sig_imag[i],2));
        spec[i] = 20*Math.log(spec_lin[i])/Math.log(10);
      }



      //analyser.getFloatFrequencyData(dataFreq); // récupération du spectre





			if (waitingfortrigger) {
				switch (mes) {
					case 1:
						spectrum1 = [...spec];
						ismes1 = true;
						break;
					case 2:
						spectrum2 = [...spec];
						ismes2 = true;
						break;
					case 3:
						spectrum3 = [...spec];
						ismes3 = true;
						break;
				}
			}


			couleurcurseur = "white";


			if (!pause) {

				// effacement
				ctx.fillStyle = 'rgb(0, 0, 0)';
				ctx.fillRect(0, 0, WIDTH, HEIGHT);



        // detection pic derivee spectre 2

        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.strokeStyle = 'rgb(255, 128, 128)';
        ctx.lineWidth = 1;
        ctx.font = "20px guitar-bold";
        ctx.textAlign = "left";

        const ds2 = new Float32Array(kzero*Nfreqmax);
        for (var i = 1; i < kzero*Nfreqmax; i++) {
          ds2[i] = Math.pow(spec_lin[i],2)-Math.pow(spec_lin[i-1],2);
        }

        const maxds2 = Math.max.apply(null, ds2);

        let i_peak_list = [];

        for (var n_peak = 1; n_peak <= 5; n_peak++) {

        let toggle = 0
        let seuil = 0.01*maxds2;
        let i_peak = 0
        let s_peak = 0
        let fmin_peak = 2000

        	for (var i = 1; i < kzero * Nfreqmax; i++) {
        		if (ds2[i] > seuil) {
        			toggle = 1
        		}
        		if (toggle) {
        			if (ds2[i] < 0) {
        				if (spec_lin[i - 1] > s_peak & !i_peak_list.includes(i-1)) {
        					i_peak = i - 1
        					s_peak = spec_lin[i - 1]
        				}
        				toggle = 0
        			}
        		}
        	}

        i_peak_list.push(i_peak);

        const f_peak = i_peak/(Nfreqmax/kzero) * fmax
        if (f_peak >= 20) {
        const x_peak = dx_fft*(i_peak)
        const y_peak = HEIGHT - Math.max(0, (20*Math.log(s_peak)/Math.log(10)-mindB)/dyn)*HEIGHT;

        ctx.fillText(Math.round(f_peak*10)/10 + ' Hz', x_peak, y_peak-100);

        ctx.beginPath();
        ctx.moveTo(x_peak, y_peak-20);
        ctx.lineTo(x_peak, y_peak-100);
        ctx.stroke();
        }

        }

				if (!waitingfortrigger) {
					plotSpectrum(spec, 'rgb(255, 255, 255)')
				};
				if (ismes1) {
					plotSpectrum(spectrum1, 'rgb(230, 159, 0)');
				}
				if (ismes2) {
					plotSpectrum(spectrum2, 'rgb(86, 180, 233)');
				}
				if (ismes3) {
					plotSpectrum(spectrum3, 'rgb(0, 158, 115)');
				}

				// collage CANVAS vers CANVAS TEMPORAIRE
				tempctx.drawImage(canvas, 0, 0, WIDTH, HEIGHT);

				if (false) {
					var buf = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(buf);
					var ac = autoCorrelate(buf, contexteAudio.sampleRate);
					if (ac > 0) {
						fcurseur = ac;
						updateNote();
						couleurcurseur = "yellow";
					}
				}

			} else {
				ctx.fillStyle = 'rgb(255, 100, 0)';
				ctx.fillRect(0, 0, WIDTH, HEIGHT);

				// collage CANVAS TEMPORAIRE vers CANVAS
				ctx.drawImage(tempcanvas, 0, 0, WIDTH, HEIGHT);
			}


      // AFFICHAGE NOTE
			// if (fcurseur > 220 && fcurseur < 880 && imageloaded) {
			// 	var img = new Image();
			// 	img.src = imgcurseur; //ImagesNotes[0];
			// 	ctx.fillStyle = '#999';
			// 	ctx.fillRect(0, 0, 2 * img.width, 2 * img.height);
			// 	ctx.drawImage(img, 0, 0, 2 * img.width, 2 * img.height);
			// }

      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(0, HEIGHT-50, WIDTH, HEIGHT);

      // Tracé de repères fréquentiels
      let f = 0
      //console.log(WIDTH/fmax)
      //console.log(dx_spectre)
			while (f <= fmax) {

        ctx.strokeStyle = 'rgb(255, 255, 255)';
				ctx.fillStyle = 'rgb(255, 255, 255)';

        if (f%1000 == 0) {
          ctx.fillRect(f*px_par_Hz-1, HEIGHT - 50, 1, 20);
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
           ctx.font = "16px guitar-bold";
          if (f<500) { ctx.textAlign = "left";  ctx.font = "20px guitar-bold"; }
          if (f==fmax) { ctx.textAlign = "right";  ctx.font = "20px guitar-bold"; }
          ctx.fillText(f, f*px_par_Hz, HEIGHT - 20);
        } else {
          ctx.fillRect(f*px_par_Hz, HEIGHT - 50, 1, 10);
        }

        f += 100;
			}
      ctx.fillRect(0, HEIGHT - 50, WIDTH, 1);


      if (select_curseur_1.value != 'none') {
			xcurseur = fcurseur / fmax * WIDTH;

			// Tracé du curseur

      ctx.fillRect(xcurseur, 0, 1, HEIGHT-50);
      ctx.fillStyle = "#fdea14";
      ctx.fillRect(xcurseur-1, HEIGHT-50, 3, 10);

			// et le texte associé
			ctx.font = "26px guitar-bold";
			if (xcurseur < WIDTH / 3) {
				ctx.textAlign = "left";
			} else if (xcurseur > 2 * WIDTH / 3) {
				ctx.textAlign = "right";
			} else {
				ctx.textAlign = "center";
			}



      ctx.font = "26px guitar-bold";
			ctx.strokeStyle = "black";
			ctx.lineWidth = 2;
			ctx.strokeText(''+fcurseur + " Hz (" + notecurseur + ")", xcurseur, 50);
			ctx.fillStyle = couleurcurseur;
			ctx.fillText(''+fcurseur + " Hz (" + notecurseur + ")", xcurseur, 50);



			if (curseur_harmonique == 1) {
				var n = 2;

				while (n * xcurseur < WIDTH) {

					ctx.beginPath();
					ctx.moveTo(n * xcurseur, HEIGHT);
					ctx.lineTo(n * xcurseur, 0);
					ctx.strokeStyle = "red";
					ctx.lineWidth = 1;
					ctx.stroke();

					n++;
				}
			}

      }

      var fps_count = Math.round(1000/(now-toc)*10)/10;
      toc = now;
      //ctx.fillText(fps_count+' fps', 100, 100);


		};

		drawSpectrum();

	}

}



// event listeners to change visualize and voice settings

select_voie.onchange = function() {
	window.cancelAnimationFrame(drawVisual);
	var voie = select_voie.value;
	console.log(voie)

	if (voie == 'left') {
		splitter.disconnect();
		splitter.connect(analyser, 0);
		splitter.connect(analyser1, 0);
	} else {
		splitter.disconnect();
		splitter.connect(analyser, 1);
		splitter.connect(analyser1, 1);
	}


	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
};



select_curseur_1.onchange = function() {
  updateNote();
};

select_curseur.onchange = function() {
	//init();
  curseur_harmonique = select_curseur.value;
};

select_Nfft.onchange = function() {
	window.cancelAnimationFrame(drawVisual);
	init();
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
};


select_gain.onchange = function() {
	//window.cancelAnimationFrame(drawVisual);
	gain = select_gain.value;
	//tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	//visualize();
};

visualSelect.onchange = function() {
	window.cancelAnimationFrame(drawVisual);
	init();
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
};

select_fmax.onchange = function() {
	window.cancelAnimationFrame(drawVisual);
	init();
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
};

slider_vitesse.onchange = function() {
	window.cancelAnimationFrame(drawVisual);
	init();
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
};







window.onresize = function() {
	console.log("RESIZE !");
	window.cancelAnimationFrame(drawVisual);
	ctx.canvas.width = window.innerWidth;
	ctx.canvas.height = 0.8 * window.innerHeight;
	WIDTH = canvas.width;
	HEIGHT = canvas.height;
  HEIGHT1 = Math.round(0.10 * HEIGHT);
  HEIGHT2 = HEIGHT - HEIGHT1;

  // // MERITE ----------------------------------
  // // spectrogramme
  // HEIGHT1 = 100;
  // HEIGHT2 = 378;
  // HEIGHT = HEIGHT1 + HEIGHT2;
  // ctx.canvas.height = HEIGHT;
  // // spectre
  // HEIGHT1 = 100;
  // HEIGHT2 = 706-100;
  // HEIGHT = HEIGHT1 + HEIGHT2;
  // ctx.canvas.height = HEIGHT;
  // WIDTH = 652;
  // ctx.canvas.width = WIDTH;
  // // -----------------------------------------

	tempcanvas.width = WIDTH;
	tempcanvas.height = HEIGHT;
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);

	rect = canvas.getBoundingClientRect();

	init();
	visualize();
};



var colormap = function(value) {

	var fromH = 240;
	var toH = 0;
	var percent = value / 255;
	var delta = percent * (toH - fromH);
	var hue = Math.floor(fromH + delta);
	if (percent > 0) {
		return 'hsl(H, 100%, 50%)'.replace(/H/g, hue);
	} else {
		return 'rgb(0,0,0)';
	}
}

var colormap_gray = function(value) {

	var percent = value / 255;
	if (percent > 0) {
		return 'hsl(62, 0%, '+percent*100+'%)';
	} else {
		return 'rgb(0,0,0)';
	}
}




//}

function play() {
document.getElementById("bouton_pause").src = "icon_pause.png";
pause = false;
}



function stop() {

	console.log("PAUSE !");
	if (pause) {
		document.getElementById("bouton_pause").src = "icon_pause.png";
	} else {
		document.getElementById("bouton_pause").src = "icon_start.png";
	}

  console.log(document.getElementById("bouton_pause"))

	pause = !pause;

	console.log(pause)

}



function checkKey(e) {

	//e = e || window.event;

	if (e.keyCode == '38') { // up arrow
		fcurseur += 0.1;
	} else if (e.keyCode == '40') { // down arrow
		fcurseur -= 0.1;
	} else if (e.keyCode == '37') { // left arrow
		fcurseur -= 0.1;
	} else if (e.keyCode == '39') { // right arrow
		fcurseur += 0.1;
	}

	updateNote();

	osc.frequency.value = fcurseur;

}


//----------------------------------------------------------------------
// EVENEMENTS SOURIS
//----------------------------------------------------------------------


function onMouseUp(e) {
	console.log('goodbye dolly!')

	// s'il y a un son, on le coupe
	if (son == 1) {
		osc.disconnect();
		son = 0;
	}

	document.body.style.cursor = "default";

}

function onMouseDown(e) {
	console.log('hello dolly!')

	// s'il n'y a pas de son, on le déclenche
	if (son == 0 && visualSelect.value!='temporel') {
		//osc.connect(contexteAudio.destination);
		son = 1;
	}

	// les quelques lignes ci-dessous ne sont pas encore utilisées
	switch (mode_clic) {
		case 'selection':
			//console.log('clic en mode selection');
			break;

		case 'curseur':
			//console.log('clic en mode curseur');
			break;

	}


	onMouseMove(e) // utilité ???

}



function onMouseMove(e) {



	xclic = e.clientX - rect.left;
	yclic = e.clientY - rect.top;

	//console.log("xclic: " + xclic + " yclic: " + yclic);
if (yclic < HEIGHT1) {
	canvas.style.cursor = "text";
} else {
	canvas.style.cursor = "crosshair";
}


	// un bouton est-il maintenu ?
	if (e.buttons != 0) {

		// quel mode de représentation ? (l'action a effectuer est différente)
		switch (visualSelect.value) {

			case "spectre":
				fcurseur = Math.round(xclic / WIDTH * fmax);
				osc.frequency.value = fcurseur;
				break;

			case "spectrogramme":
				// ici on pourra implémenter le switch entre mode sélection et mode curseur
				fcurseur = Math.round((HEIGHT2 - (yclic - HEIGHT1)) / HEIGHT2 * fmax);
				osc.frequency.value = fcurseur;
				break;

			case "temporel":
				trig_level = (HEIGHT - yclic) / HEIGHT;
				trig_level = Math.max(0.51, trig_level);
				break;

		}

		updateNote();




	} else {

		// ici on pourra implémenter une fonctionnalité "magnétisme"


	}

}




function change_visu(e) {
  console.log('change visu')
  switch (e.target.id) {
    case 'bouton_freq':
      mindB = -120
      dyn = 120
      select_Nfft.value = 16384;
      select_fmax.value = 2000;
      visualSelect.value = "spectre";
    break;
    case 'bouton_time_freq':
    mindB = -80
    dyn = 60
    select_Nfft.value = 4096;
    select_fmax.value = 4000;
    visualSelect.value = "spectrogramme";
    break;
  }
  window.cancelAnimationFrame(drawVisual);
	init();
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();
}


function modifminmaxdB(e) {
	switch (e.target.id) {
		case 'bouton_mindBminus':
			mindB = mindB - 10;
			init();
			break;
		case 'bouton_mindBplus':
			mindB = mindB + 10;
			init();
			break;
		case 'bouton_dynminus':
			dyn = dyn - 10;
			dyn = Math.max(10, dyn);
			init();
			break;
		case 'bouton_dynplus':
			dyn = dyn + 10;
			init();
			break;
	}
}





function start_trig(e) {
	switch (e.target.id) {
		case 'bouton_tap':
      trig_level = 0.8; // réinitialiser niveau trigger
      bouton_freq.click(); // simuler clic sur bouton freq pour changer mode affichage
			mes = 1;
			break;
		case 'bouton_2':
			mes = 2;
			break;
		case 'bouton_3':
			mes = 3;
			break;
	}

	if (pause) {
		stop();
	}

	waitingfortrigger = true;

	window.cancelAnimationFrame(drawVisual);
	visualSelect.value = "temporel";
	tempctx.clearRect(0, 0, WIDTH, HEIGHT);
	visualize();




}


function updateNote() {

	fcurseur = Math.round(fcurseur * 10) / 10;

	fcurseur = Math.max(5, fcurseur); // empêcher un curseur < à 5 Hz
	fcurseur = Math.min(fmax, fcurseur); // empêcher un curseur supérieur à fmax

	notecurseur = notes[Math.round((Math.log(fcurseur / 440) / Math.log(2) * 12) % 12) + 12];
	imgcurseur = ImagesNotes[Math.round((Math.log(fcurseur / 440) / Math.log(2) * 12) % 12) + 12];

	switch (select_curseur_1.value) {
		case "single":
			list_f = [1];
			break;
		case "harmonic":
			list_f = [];
			for (var i = 1; i <= Math.floor(fmax / fcurseur); i++) {
				list_f.push(i);
			}
			break;
		case "beam_FF":
			list_f = [4.73004074, 7.85320462, 10.9956078, 14.1371655, 17.2787597];
			for (var i = 6; i <= 10; i++) {
				list_f.push((2 * i + 1) * Math.PI / 2);
			}
		list_f.forEach(function(val, i) {
        list_f[i] = Math.pow(val/4.73004074,2);
      });

			break;
		case "beam_CF":
			list_f = [1.8751, 4.6941, 7.8548, 10.9955];
		for (var i = 5; i <= 10; i++) {
				list_f.push((2 * i - 1) * Math.PI / 2);
			}
		list_f.forEach(function(val, i) {
      list_f.forEach(function(val, i) {
        list_f[i] = Math.pow(val/1.8751,2);
      });

			break;
	}

	console.log(list_f)

}




function init() {

	maxdB = mindB + dyn;

	document.getElementById("mindB").childNodes[0].nodeValue = mindB + 'dB';
	document.getElementById("dyn").childNodes[0].nodeValue = dyn + 'dB';



	analyser.minDecibels = mindB;
	analyser.maxDecibels = maxdB;

	curseur_harmonique = select_curseur.value;

  voie = select_voie.value;

	fmax = select_fmax.value;

	Nfft = select_Nfft.value;
	analyser.fftSize = Nfft;

	Nfreq = Nfft / 2

	Nfreqmax = Math.round(Nfft * fmax / Fe);


	dx_timefreq = slider_vitesse.value;
	dy_timefreq = HEIGHT2 / Nfreqmax;

	dx_spectre = WIDTH / Nfreqmax;


	px_par_s = dx_timefreq / (1 / fps);
  px_par_Hz = WIDTH/fmax;

	if (pause) {
		stop();
	}

	waitingfortrigger = false;
	ismes1 = false;
	ismes2 = false;
	ismes3 = false;

  updateNote();

}


function plotSpectrum(dataFreq, color) {

	// tracé du spectre

	ctx.moveTo(0, HEIGHT);
  ctx.beginPath();
	ctx.fillStyle = 'rgb(0, 10, 255)';

	var y;
	var x = 0;


	//for (var i = 0; i < 256; i++) {
	//if (i>250) { console.log(i) }
	//ctx.fillStyle = colormap(i);
	//ctx.fillRect(0, HEIGHT-i/255*HEIGHT, 10, 1/255*HEIGHT);
	//}


	for (var i = 0; i < Nfreqmax; i++) {

		y = HEIGHT - Math.max(0, (dataFreq[i]-mindB)/dyn)*HEIGHT;
		//y = HEIGHT - dataFreq[i] / 255 * HEIGHT;

		ctx.lineTo(x, y);

		x += dx_spectre;

	}


	//ctx.lineTo(WIDTH, HEIGHT);
	//ctx.lineTo(0, HEIGHT);

	ctx.strokeStyle = color;
	ctx.lineWidth = 2;
	ctx.stroke();
	//ctx.fill();

}




function nextpow2(n) {
  return Math.ceil(Math.log2(n));
}



// Source:
// https://ourcodeworld.com/articles/read/571/how-to-verify-when-multiple-images-have-been-loaded-in-javascript
/**
 * Loader function that helps to trigger a callback when multiple images has been loaded. Besides
 * indicates which images were correctly/wrong loaded.
 *
 * @param {Array} Images An array of strings with the paths to the images.
 * @param {Function} Callback Callback function executed when all images has been loaded or not.
 */
function ImageLoader(Images, Callback) {
	// Keep the count of the verified images
	var allLoaded = 0;

	// The object that will be returned in the callback
	var _log = {
		success: [],
		error: []
	};

	// Executed everytime an img is successfully or wrong loaded
	var verifier = function() {
		allLoaded++;

		// triggers the end callback when all images has been tested
		if (allLoaded == Images.length) {
			Callback.call(undefined, _log);
		}
	};

	// Loop through all the images URLs
	for (var index = 0; index < Images.length; index++) {
		// Prevent that index has the same value by wrapping it inside an anonymous fn
		(function(i) {
			// Image path providen in the array e.g image.png
			var imgSource = Images[i];
			var img = new Image();

			img.addEventListener("load", function() {
				_log.success.push(imgSource);
				verifier();
			}, false);

			img.addEventListener("error", function() {
				_log.error.push(imgSource);
				verifier();
			}, false);

			img.src = imgSource;
		})(index);
	}
}




var MIN_SAMPLES = 0; // will be initialized when AudioContext is created.
var GOOD_ENOUGH_CORRELATION = 0.9; // this is the "bar" for how close a correlation needs to be
var SEUIL_RMS = 0.005; // seuil sur niveau rms (ajout Fred)

function autoCorrelate(buf, sampleRate) {
	var SIZE = buf.length;
	var MAX_SAMPLES = Math.floor(SIZE / 2);
	var best_offset = -1;
	var best_correlation = 0;
	var rms = 0;
	var foundGoodCorrelation = false;
	var correlations = new Array(MAX_SAMPLES);

	for (var i = 0; i < SIZE; i++) {
		var val = buf[i];
		rms += val * val;
	}
	rms = Math.sqrt(rms / SIZE);
	if (rms < SEUIL_RMS) // not enough signal
		return -1;

	var lastCorrelation = 1;
	for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
		var correlation = 0;

		for (var i = 0; i < MAX_SAMPLES; i++) {
			correlation += Math.abs((buf[i]) - (buf[i + offset]));
		}
		correlation = 1 - (correlation / MAX_SAMPLES);
		correlations[offset] = correlation; // store it, for the tweaking we need to do below.
		if ((correlation > GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
			foundGoodCorrelation = true;
			if (correlation > best_correlation) {
				best_correlation = correlation;
				best_offset = offset;
			}
		} else if (foundGoodCorrelation) {
			// short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
			// Now we need to tweak the offset - by interpolating between the values to the left and right of the
			// best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
			// we need to do a curve fit on correlations[] around best_offset in order to better determine precise
			// (anti-aliased) offset.

			// we know best_offset >=1,
			// since foundGoodCorrelation cannot go to true until the second pass (offset=1), and
			// we can't drop into this clause until the following pass (else if).
			var shift = (correlations[best_offset + 1] - correlations[best_offset - 1]) / correlations[best_offset];
			return sampleRate / (best_offset + (8 * shift));
		}
		lastCorrelation = correlation;
	}
	if (best_correlation > 0.01) {
		// console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
		return sampleRate / best_offset;
	}
	return -1;
	//	var best_frequency = sampleRate/best_offset;
}



function load_wav(e) {
  document.getElementById('toto').click();
}

function handleFiles(fileList) {
  if (sourceWAV != null) {
		sourceWAV.disconnect();
		sourceWAV.onended = function(event) {};
	}
  //console.log(fileList[0].name);
  url = window.URL.createObjectURL(fileList[0])
  console.log(url)

  source.disconnect();


  v.style.position = "absolute";
  v.style.top = (HEIGHT1+10)+"px";
  v.style.left = "80px";
  v.style.display = "inline"
  v.src = url;
  sourceV = contexteAudio.createMediaElementSource(v);
  sourceV.connect(splitter);
  splitter.connect(contexteAudio.destination, 0);


  //bufferLoader = new BufferLoader(contexteAudio, [url], soundloaded);
  //bufferLoader.load();
}


function play_song(e) {
	if (sourceWAV != null) {
		sourceWAV.disconnect();
		sourceWAV.onended = function(event) {};
	}
	switch (e.target.id) {
		case 'bouton_wav':
			bufferLoader = new BufferLoader(contexteAudio, ['out_01.wav'], soundloaded);
			break;
		case 'bouton_song2':
			bufferLoader = new BufferLoader(contexteAudio, ['out_02.wav'], soundloaded);
			break;
		case 'bouton_song3':
			bufferLoader = new BufferLoader(contexteAudio, ['out_03.wav'], soundloaded);
			break;
		case 'bouton_song4':
			bufferLoader = new BufferLoader(contexteAudio, ['out_04.wav'], soundloaded);
			break;
	}
	bufferLoader.load();
}

function soundloaded(bufferList) {
  console.log('son chargé');
  source.disconnect();
  sourceWAV = contexteAudio.createBufferSource();
  sourceWAV.buffer = bufferList[0];
  sourceWAV.connect(splitter);
  splitter.connect(contexteAudio.destination, 0);
  sourceWAV.onended = function(event) {
    console.log('fin son');
    sourceWAV.disconnect();
    splitter.disconnect();
    source.connect(splitter); // commenter si MERITE

    var voie = select_voie.value;

    // Connect graph.
    if (voie == 'left') {
      splitter.connect(analyser, 0);
      splitter.connect(analyser1, 0);
    } else {
      splitter.connect(analyser, 1);
      splitter.connect(analyser1, 1);
    }

  }

  sourceWAV.start(0);
  //document.getElementById("toggle").style.visibility = 'hidden';
  t0 = Date.now();


  console.log(sourceWAV)

  // source.disconnect();
	// var sourceWAV = contexteAudio.createBufferSource(); // creates a sound source
	// sourceWAV.buffer = buffer; // tell the source which sound to play
	// sourceWAV.connect(splitter); // connect the source to the context's destination (the speakers)
	// splitter.connect(contexteAudio.destination, 0)
	// sourceWAV.start(0); // play the source now
	// note: on older systems, may have to use deprecated noteOn(time);
}


function BufferLoader(context, urlList, callback) {
  this.context = context;
  this.urlList = urlList;
  this.onload = callback;
  this.bufferList = new Array();
  this.loadCount = 0;
}

BufferLoader.prototype.loadBuffer = function(url, index) {
  // Load buffer asynchronously
  var request = new XMLHttpRequest();
  request.open("GET", url, true);
  request.responseType = "arraybuffer";

  var loader = this;

  request.onload = function() {
    // Asynchronously decode the audio file data in request.response
    loader.context.decodeAudioData(
      request.response,
      function(buffer) {
        if (!buffer) {
          alert('error decoding file data: ' + url);
          return;
        }
        loader.bufferList[index] = buffer;
        if (++loader.loadCount == loader.urlList.length)
          loader.onload(loader.bufferList);
      },
      function(error) {
        console.error('decodeAudioData error', error);
      }
    );
  }

  request.onerror = function() {
    alert('BufferLoader: XHR error');
  }

  request.send();
}

BufferLoader.prototype.load = function() {
  for (var i = 0; i < this.urlList.length; ++i)
  this.loadBuffer(this.urlList[i], i);
}
