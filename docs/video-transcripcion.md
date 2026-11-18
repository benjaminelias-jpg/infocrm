# Transcripción — "Si no Tenes Este Sistema en 2026, Estás Quedando Fuera"

Lautaro Barruffaldi. Transcrita automáticamente del vídeo (faster-whisper, es).
Marcas de tiempo [mm:ss]. Sirve de referencia para la capa de infoproducción
del CRM (ver `infoproduccion.md`).

---

[00:00] Ramiro cubría Emilio Axis entre muchos otros más, tienen un sistema implementado en su
[00:04] negocio que le permite saber exactamente de qué video viene cada una de sus vendas.
[00:09] Emilio Axis ya salió a hablar de esto publicamente, pero el problema es que no te está mostrando
[00:13] el sistema exacto que seguramente usan su negocio porque lo que viene a mostrar es
[00:18] básicamente un sistema manual por miro que es funcional pero te lleva mucho más tiempo
[00:24] y no tenés todos los datos.
[00:26] Rama no sale a hablar del tema, pero si le pedís una de sus recursos veratistas a dar cuenta
[00:30] en las automatizaciones de Manichad que tiene este mismo sistema que estoy explicando.
[00:35] Te lo digo porque en 2026 todo el mundo lo va a empezar a usar y lo va a empezar a decir en
[00:40] marketing, que empiezan a decir marketing con data, etcétera, etcétera, etcétera,
[00:44] y las personas que no apliquen este sistema en 2026 van a quedar por detrás porque sinceramente
[00:49] creo que operar sin este sistema es básicamente actuar a ciegas.
[00:54] Yo sabía que todo esto iba a pasar hace mucho tiempo y por eso vengo subiendo videos sobre
[00:58] el tema desde mayo de 2025, que fue cuando empecé a crear todo este sistema y desde ese
[01:04] día lo vengo mejorando día tras día.
[01:06] Y eso me permitió tener este sistema hoy que te voy a mostrar que traquea absolutamente
[01:11] todo.
[01:12] A nivel de marketing vas a saber cuántos leads te trajo cada uno estos videos,
[01:16] cuántos eran calificados mediante un sistema de calificación DSBA al estilo
[01:21] de Estados Unidos, básicamente deje el peor a el mejor.
[01:24] En caso de que vendas por llamada vas a saber exactamente cuántas agendas, cuántas presentaciones,
[01:29] cuántos cierres te trae cada uno de los videos, si te trae más gente curioso, si te trae
[01:34] gente totalmente lista para comprar.
[01:35] Y de la mano con esto que me ayudó en un montón de negocios es saber exactamente
[01:40] de qué video vienen personas que te pagan en cuotas y nunca te terminan de pagar
[01:45] y de qué video vienen personas que te pagan pif todo de une.
[01:48] Entonces vas a ver exactamente qué videos, qué tipo de videos y qué comunicación te
[01:54] trae este tipo de avatar que querés, qué fácil de entrar en el servicio, qué paga mucho
[01:59] y que tiene muchos resultados.
[02:00] Y obviamente de la mano de esto en ventas también me permite saber exactamente los
[02:05] leads calificados de los videos, exactamente en qué parte del proceso de ventas se quedan,
[02:11] qué porcentaje se queda para saber exactamente qué cosas tocar en el proceso de ventas
[02:17] para mejorarlo y hacer un porcín con tus ventas.
[02:19] Así que déjame mostrarte cómo funciona todo el sistema.
[02:23] Vamos paso a paso desde el principio de cómo empezó toda esta idea de mi sistema, ok?
[02:28] Primero todo quería saber de dónde venían cada una de mis ventas, entonces lo que prefería
[02:33] hacer para tener el traqueo general, absoluto, completo, absolutamente todo es saber
[02:39] exactamente de qué video viene cada una de mis leads.
[02:43] Por eso como si ven ahora si soy activo el lead source básicamente es exactamente de
[02:48] qué historia en este caso vino cada uno de estos leads que en este caso todos estos son
[02:52] de la historia del 6.
[02:54] Pero cómo se hace esto?
[02:55] Básicamente déjame mostrarte absolutamente todo en manychat, ok?
[02:59] Esto es muy sencillo, simplemente lo primero que vas a tener que hacer es obviamente
[03:03] tener la tabela de leads y venir a automatizaciones.
[03:06] En automatizaciones lo que vas a poner es cómo trigger cuando se recibe un webhook.
[03:11] Básicamente RTable te da un webhook, ok?
[03:14] Simplemente para copiar.
[03:17] Básicamente es un link donde cada vez que ese link recibe una petición o una solicitud
[03:23] externa justamente RTable se va a dar cuenta lo va a recibir.
[03:27] Entonces básicamente lo que vas a poner en manychat es justamente quemando una solicitud
[03:32] externa hacia tu webhook.
[03:34] Cómo se hace esto?
[03:35] Simplemente acciones, solicitud externa, ok?
[03:40] Es el link acá se le pega el webhook de RTable básicamente y en el cuerpo se pone absolutamente
[03:46] todo lo que quieras llevar.
[03:48] Básicamente en la parte del cuerpo lo que vas a poner es simplemente esto que básicamente
[03:52] te traiga el nombre de Instagram.
[03:55] En este caso el tag que básicamente es justamente el lead source escrito de manera
[04:00] manual.
[04:01] Esta es la única parte de la automatización que vas a tener que copiar, pegar y hacer
[04:04] esto de manera manual, que es básicamente simplemente poner básicamente un sistema donde
[04:10] básicamente entiendas historias, reels, anuncios, todos los tipos de contenidos que tengan, les
[04:16] pongas una letra y la fecha en la que le hiciste, personalmente eso es lo que yo siento que
[04:20] es más cómodo.
[04:21] Entonces R es de reels, del 25 al 10 del 2023 por ejemplo es este.
[04:26] Otra cosa que le agregué básicamente son los contactos que ahora yo te voy a explicar
[04:30] pero eso lo que me permite también llevar es la cantidad de veces que una persona te escribió
[04:35] antes de que sea la venta, también lo llevamos al RTable, te explico cómo traquearlo.
[04:40] Pero vamos por lo simple, primero lo más importante es que pongan estas dos líneas,
[04:44] el nombre dije y el real historia o anuncio el que viene.
[04:49] Básicamente acá simplemente vas a tener que introducir un nombre, correr una prueba,
[04:53] te va a llegar acá al RTable, probar el desencadenante, básicamente te va
[04:57] a llevar bien el body si lo hiciste como te dije, con el nombre de Instagram y el real
[05:02] y vas a ejecutar un script que básicamente es un script gigante como este que hice acá,
[05:07] que básicamente en resumidas cuentas lo que hace es crear el lead cuando entra con el
[05:14] básicamente exactamente el real de donde viene, que lo conecta automáticamente,
[05:18] que ponga la fecha automáticamente, que ponga el mes del que viene automáticamente,
[05:23] que ponga un setter también encargado automáticamente.
[05:25] Todo este script básicamente si no saben scriptear, tranquilamente se lo pueden pedir a
[05:31] chatGPT, chatGPT lo hace bastante bien también.
[05:34] Una vez tienen todo este script, básicamente lo que van a hacer, una vez tienen todo este
[05:39] script ya está tipo simplemente tienen que guardar la solicitud externa,
[05:45] simplemente corren la automatización, cada vez que una persona entra en la automatización
[05:50] se le va a mandar automáticamente a Artébol, Artébol va a cargar el lead en la tabla y ya
[05:56] sabes exactamente dónde viene cada una de tus leads ahora.
[05:59] Proces importantísimas agregar que yo agregué en mi CRM para saber exactamente todo lo que te dije
[06:04] al principio del vídeo. Primero, bajar a tierra todos los digamos los estados dentro de tu proceso
[06:11] de ventas de setting, ok? Entonces sabes exactamente dónde se quedan tus leads
[06:14] dentro del proceso de ventas, yo acá lo di literalmente pregunta por pregunta para
[06:19] saber exactamente en qué preguntas y en qué parte de la conversación se quedan las personas.
[06:24] Acá simplemente vas a meter un setter o también se puede hacer de manera automática con
[06:28] manychat, yo lo hago de manera automática con manychat que ya es otro tema, pero básicamente
[06:33] es lo mismo, se manda una solicitud externa pero acá en vez de poner el tag se pone
[06:38] un estado, ok? Y en el script de Artébol se le dice que simplemente modifique el
[06:44] estado. Cuestión, se puede hacer de manera automática si lo haces con manychat
[06:48] si tenés el setter o con manychat como yo lo tengo acá básicamente, esto o simplemente
[06:54] el setter dependiendo de la cantidad de tráfico lo va modificando de manera normal como un
[06:59] CRM normal, ok? Después estas tres columnas de acá son simplemente el sistema de calificación
[07:04] que te expliqué antes de DSBA en el que básicamente pones tres variables si no
[07:13] se activa ninguna es un lead D o sea malísimo si se activa una es un lead S o sea descalificado
[07:18] todavía si se activan dos ya es un lead B es un lead calificado apto para la venta y se
[07:24] activan los tres es un lead A básicamente perfecto para la venta. En este caso como
[07:30] vendo una low ticket en este caso en específico este sistema para una low ticket no tengo tan
[07:34] desarrollado digamos el sistema de calificación pero sigando es una high ticket es muy importante
[07:40] esto. Después simplemente la fecha de registro que esto es básicamente para traquear exactamente
[07:44] que hay cuánto tiempo estamos tardando desde que llega el lead hasta que se hace la venta
[07:49] que es muy importante. Después la cantidad de seguimientos que obviamente las traqueamos
[07:54] y también sabemos exactamente con el estado ok? Cada vez que el setter cambia el estado
[08:00] y el seguimiento cualquiera de los dos se modifica esto que es la fecha de última
[08:04] modificación ok? Entonces sabemos exactamente cuándo fue la última vez que el setter
[08:09] contactó a la persona obviamente para esto el sistema tiene que funcionar o sea el sistema
[08:14] tiene que ser usado por los setters pero si es usado de manera correcta por los setters
[08:18] sabes exactamente cuándo fue la última vez que el setter contactó a la persona no
[08:22] hay manera más sencilla práctica ordenada de llevar los leads además de que obviamente
[08:28] a los setters les sirvo muchísimo porque no se escapa ningún lead y saben exactamente
[08:32] cuándo fue la última vez que lo contactaron. Entonces en el CRM los leads yo ordeno
[08:37] por cuándo fue la última fecha de modificación entonces se les ordena dependiendo de obviamente
[08:43] los leads que primero tienen que contactar. Después de seguimientos tenemos una casilla
[08:46] de perdidos que esto es muy simple simplemente cuando el lead ya no contesta a nuestros seguimientos
[08:50] y los queremos dejar ir simplemente tocamos perdido y en el CRM los setters ya no va a
[08:56] aparecer ese lead o sea se perdido básicamente. Después el lead source que es simplemente
[09:02] un link to another record o sea un link a la tabla de sistema de contenido donde básicamente
[09:08] como les digo conectamos cada uno de los videos estos para que dentro de aquella tabla nos aparezca
[09:13] todo esto de lo que te digo de cuántos leads y demás es la forma más fácil de llevarlo
[09:18] que también la data de bueno lo mismo pero unido a una tabla de data que está dividido
[09:25] por meses enero, febrero, marzo, abril para estos para llevar toda la parte más
[09:30] contable, finanzas, métricas, las interfaces que ya les voy a mostrar y vemos. El whatsapp
[09:36] del lead si se quiere esto simplemente si el lead quiere anotar si le escriben por whatsapp
[09:41] y demás y setter encargado que es lo mismo es otro link a otra tabla donde tenemos todos
[09:46] los setters todo el equipo de setters ok todo esto básicamente cuando ponemos un lead
[09:50] cerrado ok que no le va a poner porque va a aparecer como que no pero básicamente
[09:55] automáticamente se crea un registro vamos a hacer una prueba para que lo vean
[09:58] rápido porque es bastante satisfactorio vamos a darle prueba dos le ponemos cerrado
[10:03] y automáticamente en registro de ventas y pagos se crea un registro con el nombre
[10:09] específico del lead y se lo conecta automáticamente como ven acá se conectó el
[10:12] lead nos puso el nombre que le pusimos y básicamente acá simplemente nos deja
[10:16] cargar todos los datos para saber exactamente cuánta plata le entra al
[10:20] negocio de ese lead en específico ok y obviamente si esto está conectado
[10:26] con un básicamente con una historia por ejemplo en este caso nos va a contar
[10:32] como que obviamente la mente viene de esa historia justamente esa es la idea ahora
[10:36] simplemente con estas dos tablas que le acabo de mostrar ya tenemos todo lo que
[10:40] necesitamos para traquear absolutamente todo lo que les dije en un principio del
[10:43] vídeo primero vamos básicamente vamos a ir a este sistema ok que este es
[10:47] obviamente un sistema de prueba pero igualmente se los voy a mostrar en el
[10:51] que gracias a esto ya sabemos exactamente uno cuántos leads nos
[10:55] llevaron básicamente esta es la cantidad de leads que nos llevaron por contenido
[10:58] segundo cuántos estaban calificados la tasa de calificación ok obviamente nos
[11:03] va a traquear cuántas ventas ok tuvo cada uno de esos vídeos por ejemplo en este
[11:07] caso ya nos aparece ok el revenue que es 49 99 esa cuánta plata genera el vídeo
[11:12] cuántas ventas la tasa de conversión de este vídeo en específico y acá ya
[11:17] tenemos una parte más dedicada digamos a marketing donde básicamente pongo todo
[11:21] qué tipo de vídeo era qué tipo de hook inter spick se te han dicho era básicamente y a
[11:28] nivel de historias básicamente acá si vos poniendo cuántas visitas tuvo cada una
[11:33] de tus historias por ejemplo 900 después 800 después 700 te va sacando
[11:39] exactamente cuál es la tasa de tropos o sea cuánta cuánto cuál es el
[11:44] porcentaje de personas que se perdieron en cada una de las historias si
[11:48] esto está siempre por arriba de 10 es básicamente una tasa de tropos muy alta
[11:53] entonces puedo hacer un estudio de qué historias me genera que las personas se
[11:57] vayan de mi secuencia y historias qué secuencias hace que se queden obviamente
[12:02] además de saber todo esto de ok cuánta qué secuencias me generan plata que
[12:08] secuencias me traen clientes calificados etcétera todo el resto lo tengo en la
[12:12] parte de interfaces para mirarlos sin problema básicamente por ejemplo esto
[12:16] es lo que le decía de setting exactamente en el setting de los leads calificados
[12:20] qué porcentaje específico se quedó en cada uno de las etapas esto es lo esto es
[12:26] realmente lo que yo veo en el día a día las tablas básicamente son se arman una
[12:31] vez y básicamente después quedan corriendo en automático y después lo
[12:35] único que tenéis que entrar a ver son las interfaces para tener toda la
[12:39] data que necesitas por ejemplo en este caso 49 por ciento de los leads no se
[12:43] contactaron 45 están en objetivo 3 en como trabajo 3 en el 3 por ciento en
[12:49] audio ofrecido de más entonces sabemos exactamente de los leads calificados
[12:53] donde se están quedando obviamente el no contactado siempre tiene que estar en
[12:56] cero y bueno después vas viendo cada una de las etapas acá abajo tengo el
[13:00] sistema de calificación de dcvás básicamente que en este caso en
[13:04] específico como todavía el sistema no está en funcionamiento nos aparece
[13:09] como que todo está en dé porque porque todos los leads básicamente tienen las
[13:14] tres casillas desactivadas como vienen simplemente el men y chat porque era
[13:18] simplemente para ver si llevan viendo el men y chat ok pero en este caso
[13:22] básicamente te va a aparecer de la cantidad de leads total es que en este
[13:24] caso es 457 qué porcentaje era dsba básicamente esto es a nivel general no
[13:33] a nivel de marketing sino más a nivel de leads a nivel de ventas lo que
[13:37] nos interesa sabemos la cantidad de leads la cantidad de ventas la tasa de
[13:42] conversión que estamos teniendo esto acá es un simple gráfico de muestra ok de las
[13:45] ventas de dónde vino cada una de las ventas ok de dónde vinieron más ventas
[13:50] etcétera en este caso sólo hay una venta en la historia 2 del 6 del 2 del 26
[13:55] ejemplo esto acá que igualmente es más para la haría de ventas pero se lo
[13:59] puedo mostrar de todas maneras a la izquierda tenemos como el objetivo del
[14:03] mes ok que son cinco mil leads 4500 calificados toda la tasa de digamos todo
[14:08] el proceso de ventas y que se terminan cerrando 500 una tasa de conversión del
[14:12] 10% y exactamente como vamos en el mes en este caso 456 del
[14:17] leads todo el proceso de ventas cerrados tanto ok excelente la única tabla que
[14:23] después básicamente vas a mirar y te va a interesar es esta de sistema de
[14:27] contenido donde básicamente te vas a sentar cada fin de semana a analizar el
[14:31] contenido o tener una persona como yo que se siente y analiza todo el contenido
[14:34] después te de las ideas ganadoras básicamente simplemente lo que vas a
[14:38] hacer es sentarte como te iba a analizar el contenido dependiendo de los leads
[14:43] calificados llamadas en este caso directamente ventas que te genera tasa
[14:47] de conversión tipo de lid que te trae etcétera y básicamente después vas a
[14:52] poder crear una plantilla de contenido como es esto básicamente después tenés
[14:57] las plantillas de contenido no básicamente yo lo divido en posibles
[15:01] plantillas o sea videos que funcionaron de una a dos veces en nuestra cuenta o
[15:06] también puede ser videos que funcionaron múltiples veces pero en cuentas de la
[15:11] competencia o sea todavía no lo probamos y después están ya los reels
[15:14] comprobados que puede ser cuando un lead ya funcionó muchísimas veces en la
[15:18] competencia y no funciona nosotros o cuando un reel funciona dos tres
[15:23] cuatro cinco veces ya en nuestra cuenta y tal o tenemos como comprobado entonces
[15:28] entramos acá y simplemente por ejemplo tenemos un tipo de contenido ok y
[15:32] básicamente toda la semana es lo que yo así era por ejemplo en este caso de
[15:36] de este cliente teníamos todos estos digamos formatos comprobados varios de
[15:43] venta algunos de la audiencia y muy pocos de alcance lo que así era
[15:47] simplemente dependiendo de qué necesitaba el negocio si necesitaba
[15:50] alcance audiencia o sea nutrición o ventas simplemente entraba acá veía qué
[15:56] tipo de contenido ya estaba comprobado qué tipo de contenido falta tipo estaba
[15:59] por comprobar lo terminaba de comprobar o simplemente usar uno de los que ya funciona
[16:04] y y simplemente los usaba y tenía ventas nutrición o alcance al momento que
[16:11] quería y esto es lo que te digo de si no tenés esto estás actuando a
[16:15] ciegas básicamente porque estoy seguro de que tenés videos que te
[16:18] generaron ventas tenés videos que nutrieron muy bien a las personas y
[16:21] tuvieron una buena respuesta pero como nunca te sentás nunca tener uno que no
[16:26] tenés un sistema y dos que nunca te sentás a analizar todos estos datos y
[16:30] entender qué fue lo que hizo que les gusta a las personas qué fue lo que hizo
[16:34] que venda porque sé que por ahí en el fondo de tu cabeza sabes o sea decís
[16:38] pensás que sabes más o menos por qué es pero no tenés claridad absoluta de
[16:44] o qué quiero vendas voy a hacer exactamente este vídeo es como que todo el
[16:48] tiempo está en esa etapa de prueba y por eso te digo en 2025 eso servía y
[16:53] todos los años anteriores están en constante prueba servía porque el
[16:58] mercado todavía no está tan sofisticado básicamente probadas probadas
[17:01] probadas y siempre tenés esa tasa de éxito del 20 por ciento pero lo que
[17:06] te quiero decir hoy es que eso es simplemente una etapa todo el mundo está
[17:10] en la etapa de prueba en la etapa de ok sé más o menos qué me funciona y tengo
[17:14] un 20 por ciento de tasa de éxito después hay otras personas que bueno van
[17:19] llevando esa tasa de éxito a 30 40 por ciento simplemente por tener mucha
[17:23] experiencia por crear años y años de contenido pero con sistemas como estos
[17:28] básicamente llevas de manera mucho más rápido y puedes llegar a tener un día
[17:32] 100 por ciento de efectividad era como yo lo tenía con este cliente
[17:36] básicamente no te voy a decir que era 100 por ciento pero ya vamos
[17:39] trabajando cuatro meses y ya el 90 por ciento de los vídeos casíamos casi
[17:44] siempre sabíamos exactamente que nos iban a generar ventas y lo hacían
[17:48] era una tranquilidad absoluta porque sabías exactamente ok tenemos tantas
[17:53] historias sabemos que absolutamente de esta historia probablemente nos lleguen
[17:57] 500 personas de este reel nos lleguen mil personas un poco menos menos
[18:02] calificadas y con eso vamos a sacar tantas ventas podía predecir la
[18:05] semana desde antes con total claridad si no necesitaba tanto tráfico
[18:09] simplemente probado contenido nuevo y obviamente iba otra vez a la etapa de
[18:14] probar porque nunca hay que dejar de probar para seguir sacando ideas ganadoras
[18:18] nuevas y obviamente pasa exactamente lo mismo a nivel de venta si no tenés un
[18:21] sistema como este tenés semanas que te va muy bien y tenés semanas que te va
[18:25] horrible pero sin un sistema todo es malo porque si te va bien no sabes
[18:30] por qué si no te va bien no sabes por qué tampoco no tenés control
[18:33] absoluto de nada no sabes si no vendés porque no tenés suficientes leads porque
[18:37] tu tasa de calificación está mal porque hiciste un tipo de contenido que no
[18:40] deberías haber hecho no sabes si es problema de ventas en algún caso de
[18:45] que los eternos están contactando tanto las personas o se están quedando las
[18:49] personas en un paso específico el proceso de ventas que eso no te lo puedes
[18:53] meter a ver manualmente o qué mierda es lo que pasa en tu negocio porque
[18:57] déjame decirte que yo no lo veía hasta que en un negocio implementé
[19:01] este sistema y de todos los negocios que estuve después o sea me molesta me me
[19:07] da dolor de cabeza a ver cómo se toman decisiones sin este sistema son
[19:11] decisiones en el aire en base a sus posiciones que muchas veces no son
[19:16] correctas mira yo sé que viniste a este vídeo buscando más información que
[19:20] otra cosa saber cuál era el sistema mira yo sé que viniste a este vídeo
[19:24] buscando más mira yo sé que viniste a este vídeo buscando más información
[19:28] otra cosa saber exactamente o qué cuál es el sistema que están usando los
[19:32] grandes allá afuera porque como te mostre en esta captura ahora que sabes te
[19:37] das cuenta que por ejemplo rama en este caso está usando exactamente el mismo
[19:41] sistema de men y chat con el table conectados entonces te di absolutamente
[19:44] toda la información ya sabes cómo traquear con men y chat y artebol
[19:48] exactamente donde vienen tus ventas donde se quedan tasa de calificación
[19:53] en el proceso de ventas cuál es de pan en full cuál es de pan en cuotas
[19:57] etcétera etcétera etcétera pero uno no tenés tiempo para aplicar este sistema o
[20:02] dos no tenés el conocimiento de artebol necesario para aplicar todo este
[20:07] sistema por eso si querés aplicar este mismo sistema para dar un salto
[20:11] increíble en tu negocio y empezar a actuar con claridad nivel de marketing y
[20:16] ventas simplemente en la descripción tenés mi número de whatsapp sabes que
[20:20] puedes escribirme por ahí y siendo de cien por ciento transparente voy a ver
[20:23] tu negocio voy a ver si me conviene trabajar con vos y si es así te
[20:26] voy a implementar el sistema por otra parte si veo que no estás en una
[20:29] etapa en la que necesitás el sistema y en el que va a hacer algo importante en tu
[20:32] negocio lastimosamente no te lo voy a dar porque no tienes sentido entonces está
[20:36] haciendo menos de 10 mil 15 mil dólares te diría que en la mayoría de los
[20:40] casos ni siquiera me escribas porque ya sé lo que te voy a decir te voy a
[20:43] decir que no es lo importante ahora los sistemas son más para negocios que
[20:47] ya están avanzados ya tienen mucha data para recolectar para analizar y
[20:51] para tomar decisiones no vemos