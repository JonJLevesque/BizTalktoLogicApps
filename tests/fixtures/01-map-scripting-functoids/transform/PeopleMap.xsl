<?xml version="1.0" encoding="UTF-16"?>
<!--
  BizTalk Compiled Map XSLT
  ===========================
  This is what BizTalk produces when you compile a .btm (map) file that uses C# scripting functoids.
  The BTM visual map editor generates this XSLT, which BizTalk executes at runtime via MSXML.

  CRITICAL MIGRATION NOTE:
  Logic Apps XSLT action uses .NET's System.Xml.Xsl.XslCompiledTransform, which does NOT support
  msxsl:script blocks. This XSLT cannot be used as-is in Logic Apps.

  Migration options:
    1. Rewrite as LML (Logic Apps Mapping Language / Data Mapper) — recommended
    2. Wrap in Azure Function (.NET) that executes XSLT with MSXML or XslTransform
    3. Rewrite to XSLT 1.0 without scripting (replace C# with pure XPath/XSLT where possible)

  Source schema:  http://ComoFuncinamOsMapas.PessoaOrigem
  Target schema:  http://ComoFuncinamOsMapas.PessoaDestino2
  Based on:       Sandro Pereira (sandroasp) "Como Funcionam os Mapas" tutorial series
-->
<xsl:stylesheet
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:msxsl="urn:schemas-microsoft-com:xslt"
  xmlns:var="http://schemas.microsoft.com/BizTalk/2003/var"
  xmlns:s0="http://ComoFuncinamOsMapas.PessoaOrigem"
  xmlns:s1="http://ComoFuncinamOsMapas.PessoaDestino2"
  xmlns:userCSharp="http://schemas.microsoft.com/BizTalk/2003/userCSharp"
  exclude-result-prefixes="s0 var userCSharp"
  version="1.0">

  <xsl:output omit-xml-declaration="yes" method="xml" version="1.0"/>

  <!--
    C# Scripting Functoids
    ======================
    These are compiled into the XSLT by BizTalk's map compiler.
    Each function corresponds to a "Scripting" functoid placed on the map canvas.

    ⚠️  These will NOT execute in Logic Apps XSLT action (no msxsl:script support).
    ⚠️  The migration engine must detect these and generate LML/WDL equivalents.
  -->
  <msxsl:script language="C#" implements-prefix="userCSharp">
    <msxsl:using namespace="System"/>
    <msxsl:using namespace="System.Globalization"/>
    <![CDATA[

    // StringConcat functoid — joins three string arguments
    // Migration → LML: concat($param0, $param1, $param2)
    // Migration → WDL: @{concat(param0, param1, param2)}
    public string StringConcat(string param0, string param1, string param2)
    {
        return param0 + param1 + param2;
    }

    // CalcularIdade — compute age in years from an ISO 8601 date string
    // ⚠️  Uses DateTime.Now — result is date-dependent. Expected output was generated 2026-02-23.
    // Migration → WDL (approximate): @{sub(int(formatDateTime(utcNow(),'yyyy')), int(formatDateTime(dob,'yyyy')))}
    // Migration → LML: requires custom helper or split expression
    public string CalcularIdade(string dataNascimento)
    {
        if (string.IsNullOrEmpty(dataNascimento)) return "0";
        DateTime dtNascimento = DateTime.Parse(dataNascimento, CultureInfo.InvariantCulture);
        DateTime hoje = DateTime.Now;
        int idade = hoje.Year - dtNascimento.Year;
        if (dtNascimento.Month > hoje.Month ||
            (dtNascimento.Month == hoje.Month && dtNascimento.Day > hoje.Day))
        {
            idade--;
        }
        return idade.ToString();
    }

    // LogicalIsString — returns true if the value is a non-null string
    // Migration → LML: isString($val) or conditional check
    // Migration → WDL: @{equals(string(val), val)} (approximate)
    public bool LogicalIsString(object val)
    {
        if (val == null) return false;
        return val is string;
    }

    // StringLeft — returns leftmost n characters of a string
    // Migration → LML: substring($str, 1, $length)
    // Migration → WDL: @{substring(str, 0, length)}
    public string StringLeft(string str, int length)
    {
        if (string.IsNullOrEmpty(str)) return "";
        if (str.Length <= length) return str;
        return str.Substring(0, length);
    }

    // LogicalEq — case-insensitive string equality check
    // Migration → LML: equals($param0, $param1)
    // Migration → WDL: @{equals(toLower(param0), toLower(param1))}
    public bool LogicalEq(string param0, string param1)
    {
        return string.Equals(param0, param1, StringComparison.OrdinalIgnoreCase);
    }

    // LogicalNot — boolean negation
    // Migration → LML: not($val)
    // Migration → WDL: @{not(val)}
    public bool LogicalNot(bool val)
    {
        return !val;
    }

    ]]>
  </msxsl:script>

  <!-- Main entry point — matches document root -->
  <xsl:template match="/">
    <xsl:apply-templates select="/s0:PessoaOrigem"/>
  </xsl:template>

  <!-- Primary transformation template -->
  <xsl:template match="/s0:PessoaOrigem">

    <!--
      Cumulative sum variables for billing segregation.
      XPath sum() with predicate filter — selects items by value threshold.

      BizTalk Functoid pattern: "Cumulative Sum" functoid with conditional scripting.
      In the compiled XSLT this becomes standard XPath sum() with a predicate.
      This IS compatible with Logic Apps XSLT (no C# needed for this part).

      LML equivalent:
        sum(filter(/Faturamento/Item, item => number(item/Valor) < 500)/Valor)
    -->
    <xsl:variable name="valoresBaixos">
      <xsl:value-of select="sum(s0:Pessoa/s0:Faturamento/s0:Item[number(s0:Valor) &lt; 500]/s0:Valor)"/>
    </xsl:variable>
    <xsl:variable name="valoresAltos">
      <xsl:value-of select="sum(s0:Pessoa/s0:Faturamento/s0:Item[number(s0:Valor) &gt;= 500]/s0:Valor)"/>
    </xsl:variable>

    <s1:PessoaDestino2>
      <PessoaDestino>

        <!--
          NAME CONCATENATION
          BizTalk Functoid: Scripting (C#) → StringConcat
          Calls the userCSharp:StringConcat function defined in the msxsl:script block above.
          Logic Apps LML: concat(/Pessoa/Nome, ' ', /Pessoa/Apelido)
          Logic Apps WDL: @{concat(body('Parse_XML')?['Nome'], ' ', body('Parse_XML')?['Apelido'])}
        -->
        <NomeCompleto>
          <xsl:value-of select="userCSharp:StringConcat(
            string(s0:Pessoa/s0:Nome),
            ' ',
            string(s0:Pessoa/s0:Apelido))"/>
        </NomeCompleto>

        <!--
          AGE CALCULATION
          BizTalk Functoid: Scripting (C#) → CalcularIdade
          ⚠️ Date-dependent — uses DateTime.Now internally.
          Logic Apps WDL (approximate, year only):
            @{string(sub(int(formatDateTime(utcNow(),'yyyy')),
                         int(formatDateTime(body('Parse_XML')?['DataNascimento'],'yyyy'))))}
        -->
        <Idade>
          <xsl:value-of select="userCSharp:CalcularIdade(string(s0:Pessoa/s0:DataNascimento))"/>
        </Idade>

        <!--
          ADDRESS PASSTHROUGH
          BizTalk: Direct links in BTM editor — no functoid, just field-to-field mapping.
          Logic Apps LML: direct source → target mappings (simplest LML case)
          Logic Apps WDL: @{body('Parse_XML')?['Endereco']?['Rua']}  etc.
        -->
        <Endereco>
          <Rua>
            <xsl:value-of select="s0:Pessoa/s0:Endereco/s0:Rua"/>
          </Rua>
          <Numero>
            <xsl:value-of select="s0:Pessoa/s0:Endereco/s0:Numero"/>
          </Numero>

          <!--
            CONDITIONAL POSTAL CODE
            BizTalk Functoid: Logical Is String → xsl:if
            Only emits CodigoPostal element if the source value is non-empty.
            Logic Apps LML: if(isString(/Pessoa/Endereco/CodigoPostal)) → CodigoPostal
            Logic Apps WDL: condition in Compose action or if() expression
          -->
          <xsl:if test="string-length(string(s0:Pessoa/s0:Endereco/s0:CodigoPostal)) &gt; 0">
            <CodigoPostal>
              <xsl:value-of select="s0:Pessoa/s0:Endereco/s0:CodigoPostal"/>
            </CodigoPostal>
          </xsl:if>

          <Cidade>
            <xsl:value-of select="s0:Pessoa/s0:Endereco/s0:Cidade"/>
          </Cidade>
        </Endereco>

        <!--
          BILLING SEGREGATION — Cumulative sums by threshold
          Already computed as xsl:variables above using XPath sum() with predicate.
          format-number() is XSLT 1.0 standard — works in Logic Apps XSLT action.
          Logic Apps LML: sum(filter(Items, i => number(i/Valor) < 500)/Valor)
        -->
        <Faturamento>
          <ValoresBaixos>
            <xsl:value-of select="format-number($valoresBaixos, '0.00')"/>
          </ValoresBaixos>
          <ValoresAltos>
            <xsl:value-of select="format-number($valoresAltos, '0.00')"/>
          </ValoresAltos>
        </Faturamento>

      </PessoaDestino>
    </s1:PessoaDestino2>
  </xsl:template>

</xsl:stylesheet>
