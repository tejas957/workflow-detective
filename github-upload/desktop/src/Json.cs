// Minimal JSON reader/writer (no external libraries). Objects -> Dictionary<string, object>,
// arrays -> List<object>, numbers -> double, plus string / bool / null.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace WorkflowDetective
{
    public static class Json
    {
        static readonly CultureInfo CI = CultureInfo.InvariantCulture;

        public static object Parse(string s)
        {
            int i = 0;
            object v = Value(s, ref i);
            Ws(s, ref i);
            if (i != s.Length) throw new FormatException("Unexpected text after JSON value at " + i);
            return v;
        }

        static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static void Expect(string s, ref int i, char c)
        {
            if (i >= s.Length || s[i] != c) throw new FormatException("Expected '" + c + "' at " + i);
            i++;
        }

        static object Value(string s, ref int i)
        {
            Ws(s, ref i);
            if (i >= s.Length) throw new FormatException("Unexpected end of JSON");
            char c = s[i];
            if (c == '{')
            {
                i++;
                var d = new Dictionary<string, object>();
                Ws(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    Ws(s, ref i);
                    string k = Str(s, ref i);
                    Ws(s, ref i);
                    Expect(s, ref i, ':');
                    d[k] = Value(s, ref i);
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    Expect(s, ref i, '}');
                    return d;
                }
            }
            if (c == '[')
            {
                i++;
                var a = new List<object>();
                Ws(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return a; }
                while (true)
                {
                    a.Add(Value(s, ref i));
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    Expect(s, ref i, ']');
                    return a;
                }
            }
            if (c == '"') return Str(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int st = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (st == i) throw new FormatException("Unexpected character '" + c + "' at " + i);
            return double.Parse(s.Substring(st, i - st), NumberStyles.Float, CI);
        }

        static string Str(string s, ref int i)
        {
            Expect(s, ref i, '"');
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CI));
                        i += 4; break;
                    default: throw new FormatException("Bad escape at " + i);
                }
            }
            throw new FormatException("Unterminated string");
        }

        public static string Write(object o)
        {
            var sb = new StringBuilder();
            W(sb, o);
            return sb.ToString();
        }

        static void W(StringBuilder sb, object o)
        {
            if (o == null) { sb.Append("null"); return; }
            string str = o as string;
            if (str != null) { Quote(sb, str); return; }
            if (o is bool) { sb.Append((bool)o ? "true" : "false"); return; }
            if (o is double || o is float || o is int || o is long || o is decimal || o is uint || o is short)
            {
                double d = Convert.ToDouble(o, CI);
                if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
                else if (d == Math.Floor(d) && Math.Abs(d) < 1e15) sb.Append(((long)d).ToString(CI));
                else sb.Append(d.ToString("R", CI));
                return;
            }
            var dict = o as IDictionary<string, object>;
            if (dict != null)
            {
                sb.Append('{');
                bool first = true;
                foreach (var kv in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Quote(sb, kv.Key);
                    sb.Append(':');
                    W(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }
            var en = o as IEnumerable;
            if (en != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (var x in en)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    W(sb, x);
                }
                sb.Append(']');
                return;
            }
            Quote(sb, o.ToString());
        }

        static void Quote(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '<': sb.Append("\\u003c"); break;
                    default:
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4", CI));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        /* ---- tolerant accessors ---- */
        public static Dictionary<string, object> Obj(object o) { return o as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        public static string GetString(Dictionary<string, object> d, string k, string def)
        {
            object v; return d != null && d.TryGetValue(k, out v) && v is string ? (string)v : def;
        }
        public static double GetNumber(Dictionary<string, object> d, string k, double def)
        {
            object v; return d != null && d.TryGetValue(k, out v) && v is double ? (double)v : def;
        }
        public static bool GetBool(Dictionary<string, object> d, string k, bool def)
        {
            object v; return d != null && d.TryGetValue(k, out v) && v is bool ? (bool)v : def;
        }
        public static List<object> GetList(Dictionary<string, object> d, string k)
        {
            object v; return d != null && d.TryGetValue(k, out v) ? v as List<object> : null;
        }
    }
}
